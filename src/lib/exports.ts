import { EXPORT_ROW_LIMIT, toCsv, type CsvColumn } from "@/lib/csv";
import {
  currentMonthKey,
  isValidMonthKey,
  monthRange,
  parseDateOnly,
  parseMonthKey,
  toDateOnlyString,
  yearRange,
} from "@/lib/dates";
import { ALERT_STATUSES, describeAlert, isAlertVisible } from "@/modules/alerts/domain";
import { listAlerts } from "@/modules/alerts/repository";
import { TRANSACTION_TYPES, type TransactionType } from "@/modules/budget/domain";
import {
  computeGoalProgress,
  GOAL_STATUSES,
  type GoalProgress,
} from "@/modules/budget/goals";
import {
  listBudgets,
  listBudgetsInRange,
  listGoals,
  listTransactions,
  readAccountBalance,
  sumGoalContributions,
} from "@/modules/budget/repository";
import type { ModuleKey } from "@/modules/catalog/catalog";
import type { ActiveWorkspace } from "@/modules/identity/workspace";
import { listProperties } from "@/modules/real-estate/repository";

/**
 * CSV export builders, one per entity.
 *
 * Each entity keeps its own Route Handler (`/api/export/transactions`, ...) and the
 * umbrella `/api/export?entity=...` selects one of them: both paths call the builders
 * below, so the guards, the columns and the row bound cannot drift between the two
 * entry points.
 *
 * The guards themselves are **not** here: `serveCsvExport` in `lib/export-route.ts`
 * checks the session, the module and the audit write before any builder runs. A builder
 * only reads, owner-scoped, and never trusts an identifier from the query string.
 *
 * Memory behaviour: every read asks for `EXPORT_ROW_LIMIT + 1` rows. The extra row is
 * what proves the window was cut — it is never written — so a file is at most
 * `EXPORT_ROW_LIMIT` rows plus its header, built once in memory. That is the documented
 * "bound, don't stream" decision (see `lib/csv.ts` and the architecture notes).
 */

export const EXPORT_ENTITIES = [
  "transactions",
  "properties",
  "budgets",
  "goals",
  "alerts",
] as const;

export type ExportEntity = (typeof EXPORT_ENTITIES)[number];

/** `?entity=` accepts these exact codes, like every other query filter. */
export function isExportEntity(value: string | null): value is ExportEntity {
  return value !== null && (EXPORT_ENTITIES as readonly string[]).includes(value);
}

/** The module an entity depends on, or `null` for alerts (not a module). */
export const EXPORT_MODULES: Record<ExportEntity, ModuleKey | null> = {
  transactions: "budget",
  properties: "real-estate",
  budgets: "budget",
  goals: "budget",
  alerts: null,
};

/** One delivered file, plus the facts the audit entry records. */
export type ExportFile = {
  entity: ExportEntity;
  csv: string;
  fileName: string;
  rowCount: number;
  /** True when the read hit the cap: the file is a prefix, not the whole window. */
  truncated: boolean;
  /** What the filters resolved to, in the words the audit entry uses. */
  scope: "month" | "year" | "all" | "range";
  /** Calendar day or month actually applied, when the scope has bounds. */
  from?: string;
  to?: string;
};

/**
 * A filter the caller can fix (a malformed day, a reversed range).
 *
 * Answered as a 400 rather than a silent fallback: a month link with a typo falls back
 * to the current month, but `from`/`to` name an explicit period, and exporting another
 * period than the requested one would be worse than refusing.
 */
export class ExportFilterError extends Error {
  constructor(
    readonly parameter: "from" | "to",
    readonly code: "invalid_date" | "reversed_range",
  ) {
    super(
      code === "reversed_range"
        ? "`from` must not be later than `to`."
        : `Invalid ${parameter}: expected the YYYY-MM-DD format.`,
    );
    this.name = "ExportFilterError";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** One row more than the cap, so a cut is provable rather than silent. */
const READ_LIMIT = EXPORT_ROW_LIMIT + 1;

/** Splits the rows at the cap and reports whether anything was left out. */
function boundRows<Row>(rows: readonly Row[]): { rows: Row[]; truncated: boolean } {
  return rows.length > EXPORT_ROW_LIMIT
    ? { rows: rows.slice(0, EXPORT_ROW_LIMIT), truncated: true }
    : { rows: [...rows], truncated: false };
}

function parseBound(raw: string | null, parameter: "from" | "to"): Date | undefined {
  if (raw === null || raw === "") {
    return undefined;
  }

  try {
    return parseDateOnly(raw);
  } catch {
    throw new ExportFilterError(parameter, "invalid_date");
  }
}

/**
 * The `from`/`to` window of a request, both bounds being calendar days.
 *
 * `from` is inclusive and `to` is inclusive as the owner writes it; the returned upper
 * bound is the next day, exclusive, which is the convention every read in the project
 * uses (`monthRange`). Both sides are optional: `?from=2026-01-01` reads everything
 * after that day.
 */
function readWindow(params: URLSearchParams): {
  from?: Date;
  to?: Date;
  fromDay?: string;
  toDay?: string;
} {
  const from = parseBound(params.get("from"), "from");
  const to = parseBound(params.get("to"), "to");

  if (from && to && from.getTime() > to.getTime()) {
    throw new ExportFilterError("from", "reversed_range");
  }

  return {
    from,
    to: to ? new Date(to.getTime() + DAY_MS) : undefined,
    fromDay: from ? toDateOnlyString(from) : undefined,
    toDay: to ? toDateOnlyString(to) : undefined,
  };
}

function rangeFileName(prefix: string, from?: string, to?: string): string {
  if (from && to) {
    return `${prefix}-${from}_${to}.csv`;
  }

  return from ? `${prefix}-depuis-${from}.csv` : `${prefix}-jusqua-${to}.csv`;
}

function scopeOf(window: { from?: Date; to?: Date }, fallback: ExportFile["scope"]) {
  return window.from || window.to ? "range" : fallback;
}

/** `YYYY-MM` of a calendar day, for the budget window and its file name. */
function monthKeyOf(day: Date): string {
  return toDateOnlyString(day).slice(0, 7);
}

/* -------------------------------------------------------------------------- */
/* Transactions                                                               */
/* -------------------------------------------------------------------------- */

type TransactionRow = {
  operationDate: string;
  label: string;
  account: string;
  category: string;
  type: string;
  amount: string;
  currency: string;
  reconciledOn: string;
  notes: string;
  sourceRef: string;
};

const TRANSACTION_COLUMNS: CsvColumn<TransactionRow>[] = [
  { key: "operationDate", header: "date_operation" },
  { key: "label", header: "libelle" },
  { key: "account", header: "compte" },
  { key: "category", header: "categorie" },
  { key: "type", header: "type" },
  { key: "amount", header: "montant" },
  { key: "currency", header: "devise" },
  { key: "reconciledOn", header: "pointe_le" },
  { key: "notes", header: "notes" },
  { key: "sourceRef", header: "reference_source" },
];

/**
 * Transactions, with the filters of the operations tab.
 *
 * Scope, first match winning: an explicit `from`/`to` window, then `?all=1` (every
 * month), then `?year=YYYY`, then `?month=YYYY-MM`, then the current month. The account,
 * category, type, text and reconciliation filters apply in every scope, so the file
 * matches what the screen showed.
 */
export async function exportTransactions(
  workspace: ActiveWorkspace,
  params: URLSearchParams,
): Promise<ExportFile> {
  const window = readWindow(params);

  const monthParam = params.get("month");
  const monthKey = isValidMonthKey(monthParam) ? monthParam : currentMonthKey();
  const { year, month } = parseMonthKey(monthKey);
  const allScope = params.get("all") === "1";
  const yearParam = params.get("year");
  const yearRequested = /^\d{4}$/.test(yearParam ?? "") ? Number(yearParam) : null;

  let bounds: { from?: Date; to?: Date } = {};
  let scope: ExportFile["scope"] = "month";
  let fileName = `transactions-${monthKey}.csv`;
  let fromLabel: string | undefined = monthKey;
  let toLabel: string | undefined;

  if (window.from || window.to) {
    bounds = { from: window.from, to: window.to };
    scope = "range";
    fileName = rangeFileName("transactions", window.fromDay, window.toDay);
    fromLabel = window.fromDay;
    toLabel = window.toDay;
  } else if (allScope) {
    scope = "all";
    fileName = "transactions-complet.csv";
    fromLabel = undefined;
  } else if (yearRequested !== null) {
    const range = yearRange(yearRequested);
    bounds = { from: range.start, to: range.end };
    scope = "year";
    fileName = `transactions-${yearRequested}.csv`;
    fromLabel = `${yearRequested}-01-01`;
    toLabel = `${yearRequested}-12-31`;
  } else {
    const range = monthRange(year, month);
    bounds = { from: range.start, to: range.end };
  }

  const rawType = params.get("type");
  const type = TRANSACTION_TYPES.find((value) => value === rawType) as
    | TransactionType
    | undefined;
  const rawReconciled = params.get("reconciled");

  const { rows: transactions, truncated } = boundRows(
    await listTransactions(workspace.id, {
      ...bounds,
      accountId: params.get("account") ?? undefined,
      categoryId: params.get("category") ?? undefined,
      type,
      search: params.get("q") ?? undefined,
      reconciled:
        rawReconciled === "0" ? false : rawReconciled === "1" ? true : undefined,
      take: READ_LIMIT,
    }),
  );

  const rows: TransactionRow[] = transactions.map((transaction) => ({
    operationDate: toDateOnlyString(transaction.operationDate),
    label: transaction.label,
    account: transaction.accountName ?? "",
    category: transaction.categoryName ?? "",
    type: transaction.type,
    // Exact decimal string: no float, no thousands separator, dot as separator.
    amount: transaction.amount.toFixed(2),
    currency: transaction.currency,
    reconciledOn:
      transaction.reconciledAt === null ? "" : toDateOnlyString(transaction.reconciledAt),
    notes: transaction.notes ?? "",
    sourceRef: transaction.externalRef ?? "",
  }));

  return {
    entity: "transactions",
    csv: toCsv(rows, TRANSACTION_COLUMNS),
    fileName,
    rowCount: rows.length,
    truncated,
    scope,
    ...(fromLabel ? { from: fromLabel } : {}),
    ...(toLabel ? { to: toLabel } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Properties                                                                 */
/* -------------------------------------------------------------------------- */

type PropertyRow = {
  name: string;
  address: string;
  occupancy: string;
  purchaseDate: string;
  purchasePrice: string;
  estimatedValue: string;
  estimatedValueAsOf: string;
  targetGainRate: string;
  saleDate: string;
  salePrice: string;
  saleCosts: string;
  currency: string;
  priceCurrency: string;
  income: string;
  expenses: string;
  net: string;
  cashflowCount: string;
  notes: string;
};

const PROPERTY_COLUMNS: CsvColumn<PropertyRow>[] = [
  { key: "name", header: "nom" },
  { key: "address", header: "adresse" },
  { key: "occupancy", header: "occupation" },
  { key: "purchaseDate", header: "date_acquisition" },
  { key: "purchasePrice", header: "prix_acquisition" },
  { key: "estimatedValue", header: "valeur_estimee" },
  { key: "estimatedValueAsOf", header: "valeur_estimee_au" },
  { key: "targetGainRate", header: "objectif_plus_value_pct" },
  { key: "saleDate", header: "date_cession" },
  { key: "salePrice", header: "prix_cession" },
  { key: "saleCosts", header: "frais_cession" },
  { key: "currency", header: "devise" },
  { key: "priceCurrency", header: "devise_prix" },
  { key: "income", header: "recettes" },
  { key: "expenses", header: "charges" },
  { key: "net", header: "solde" },
  { key: "cashflowCount", header: "nombre_de_flux" },
  { key: "notes", header: "notes" },
];

/**
 * Properties with their totals.
 *
 * `from`/`to` select an **acquisition** window: it is the only dated fact every property
 * carries. A property without an acquisition date is therefore absent from a windowed
 * file — it cannot be said to belong to the period. The money columns stay the lifetime
 * totals of each property, window or not.
 */
export async function exportProperties(
  workspace: ActiveWorkspace,
  params: URLSearchParams,
): Promise<ExportFile> {
  const window = readWindow(params);

  const { rows: properties, truncated } = boundRows(
    await listProperties(workspace.id, {
      from: window.from,
      to: window.to,
      take: READ_LIMIT,
    }),
  );

  const rows: PropertyRow[] = properties.map((property) => ({
    name: property.name,
    address: property.address ?? "",
    occupancy: property.occupancy,
    purchaseDate: property.purchaseDate ? toDateOnlyString(property.purchaseDate) : "",
    purchasePrice: property.purchasePrice ? property.purchasePrice.toFixed(2) : "",
    estimatedValue: property.estimatedValue ? property.estimatedValue.toFixed(2) : "",
    estimatedValueAsOf: property.estimatedValueAsOf
      ? toDateOnlyString(property.estimatedValueAsOf)
      : "",
    targetGainRate: property.targetGainRate.toFixed(2),
    saleDate: property.saleDate ? toDateOnlyString(property.saleDate) : "",
    salePrice: property.salePrice ? property.salePrice.toFixed(2) : "",
    saleCosts: property.saleCosts ? property.saleCosts.toFixed(2) : "",
    currency: property.currency,
    priceCurrency: property.priceCurrency,
    income: property.income.toFixed(2),
    expenses: property.expenses.toFixed(2),
    net: property.net.toFixed(2),
    cashflowCount: String(property.cashflowCount),
    notes: property.notes ?? "",
  }));

  const scope = scopeOf(window, "all");

  return {
    entity: "properties",
    csv: toCsv(rows, PROPERTY_COLUMNS),
    fileName:
      scope === "range"
        ? rangeFileName("immobilier", window.fromDay, window.toDay)
        : "immobilier.csv",
    rowCount: rows.length,
    truncated,
    scope,
    ...(scope === "range" ? { from: window.fromDay, to: window.toDay } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Budgets                                                                    */
/* -------------------------------------------------------------------------- */

type BudgetRow = {
  month: string;
  category: string;
  kind: string;
  currency: string;
  amount: string;
};

const BUDGET_COLUMNS: CsvColumn<BudgetRow>[] = [
  { key: "month", header: "mois" },
  { key: "category", header: "categorie" },
  { key: "kind", header: "nature" },
  { key: "currency", header: "devise" },
  { key: "amount", header: "montant_prevu" },
];

/** The month a budget window ends on, from the exclusive day-after bound. */
function monthOfInclusiveEnd(exclusiveEnd: Date): { year: number; month: number } {
  const lastDay = new Date(exclusiveEnd.getTime() - DAY_MS);
  return { year: lastDay.getUTCFullYear(), month: lastDay.getUTCMonth() + 1 };
}

/**
 * Monthly budgets.
 *
 * One month per file by default (`?month=YYYY-MM`, current month when absent or
 * malformed). A `from`/`to` window selects **whole months**: `from=2026-02-15` starts at
 * February 2026 and `to=2026-04-02` ends at April 2026, because a budget is stored per
 * month, not per day. Only one side is enough; the missing side is unbounded.
 */
export async function exportBudgets(
  workspace: ActiveWorkspace,
  params: URLSearchParams,
): Promise<ExportFile> {
  const window = readWindow(params);

  if (window.from || window.to) {
    const fromMonth = window.from
      ? { year: window.from.getUTCFullYear(), month: window.from.getUTCMonth() + 1 }
      : undefined;
    const toMonth = window.to
      ? // The exclusive end is the day after `to`; when `to` is the last day of its
        // month, that next day would name the following month. Step back one day first.
        monthOfInclusiveEnd(window.to)
      : undefined;

    const { rows: budgets, truncated } = boundRows(
      await listBudgetsInRange(workspace.id, {
        from: fromMonth,
        to: toMonth,
        take: READ_LIMIT,
      }),
    );

    const fromKey = window.from ? monthKeyOf(window.from) : undefined;
    const toKey = window.toDay ? window.toDay.slice(0, 7) : undefined;

    const rows: BudgetRow[] = budgets.map((budget) => ({
      month: `${budget.year}-${String(budget.month).padStart(2, "0")}`,
      category: budget.categoryName,
      // Raw kind, like the transactions export keeps the raw type: the file is data.
      kind: budget.categoryKind,
      currency: budget.currency,
      // Exact decimal string: no float, no thousands separator, dot as separator.
      amount: budget.amount.toFixed(2),
    }));

    return {
      entity: "budgets",
      csv: toCsv(rows, BUDGET_COLUMNS),
      fileName: rangeFileName("budgets", fromKey, toKey),
      rowCount: rows.length,
      truncated,
      scope: "range",
      from: fromKey,
      to: toKey,
    };
  }

  const monthParam = params.get("month");
  const monthKey = isValidMonthKey(monthParam) ? monthParam : currentMonthKey();
  const { year, month } = parseMonthKey(monthKey);

  const budgets = await listBudgets(workspace.id, { year, month });

  const rows: BudgetRow[] = budgets.map((budget) => ({
    month: monthKey,
    category: budget.categoryName,
    kind: budget.categoryKind,
    currency: budget.currency,
    amount: budget.amount.toFixed(2),
  }));

  return {
    entity: "budgets",
    csv: toCsv(rows, BUDGET_COLUMNS),
    fileName: `budgets-${monthKey}.csv`,
    rowCount: rows.length,
    truncated: false,
    scope: "month",
    from: monthKey,
  };
}

/* -------------------------------------------------------------------------- */
/* Goals                                                                      */
/* -------------------------------------------------------------------------- */

type GoalRow = {
  name: string;
  currency: string;
  targetAmount: string;
  targetDate: string;
  status: string;
  source: string;
  account: string;
  current: string;
  percent: string;
  remaining: string;
  contribution: string;
  note: string;
};

const GOAL_COLUMNS: CsvColumn<GoalRow>[] = [
  { key: "name", header: "nom" },
  { key: "currency", header: "devise" },
  { key: "targetAmount", header: "montant_cible" },
  { key: "targetDate", header: "date_cible" },
  { key: "status", header: "statut" },
  { key: "source", header: "source_montant_actuel" },
  { key: "account", header: "compte" },
  { key: "current", header: "montant_actuel" },
  { key: "percent", header: "progression_pourcent" },
  { key: "remaining", header: "reste" },
  { key: "contribution", header: "contribution_mensuelle" },
  { key: "note", header: "note" },
];

/** How the current amount is sourced, in the same words the screen uses. */
function sourceLabel(goal: { currentAmount: unknown; accountId: string | null }): string {
  if (goal.currentAmount !== null) {
    return "saisi";
  }

  return goal.accountId === null ? "aucune" : "compte";
}

function numericCells(progress: GoalProgress): Pick<
  GoalRow,
  "current" | "percent" | "remaining" | "contribution" | "note"
> {
  if (progress.kind === "UNKNOWN") {
    // Empty cells, and the reason — an unknown value must never read as a zero.
    return { current: "", percent: "", remaining: "", contribution: "", note: progress.reason };
  }

  return {
    current: progress.current.toFixed(2),
    percent: progress.percentage.toFixed(1),
    remaining: progress.remaining.toFixed(2),
    contribution: progress.monthlyContribution?.toFixed(2) ?? "",
    note: progress.contributionNote ?? "",
  };
}

/**
 * Financial goals, with the same progress rules as the screen.
 *
 * `status` filters the file (`ACTIVE`, `ACHIEVED`, `ABANDONED`); an absent or unknown
 * value exports everything. `from`/`to` apply to the **target date**. An unknown current
 * amount is written as an empty cell, never as a zero.
 */
export async function exportGoals(
  workspace: ActiveWorkspace,
  params: URLSearchParams,
): Promise<ExportFile> {
  const window = readWindow(params);
  const rawStatus = params.get("status");
  const status = GOAL_STATUSES.find((value) => value === rawStatus);

  const { rows: goals, truncated } = boundRows(
    await listGoals(workspace.id, {
      status,
      from: window.from,
      to: window.to,
      take: READ_LIMIT,
    }),
  );

  // A linked goal reads the recorded balance of its account; an account with nothing
  // recorded yields `null` (unknown), which the progress turns into empty cells. Manual
  // goals read their contribution log, so the file matches the screen exactly.
  //
  // One query per **distinct** account rather than per goal: several goals may watch the
  // same account, and a bounded read must not turn into thousands of round trips.
  const accountIds = [
    ...new Set(
      goals.flatMap((goal) => (goal.accountId === null ? [] : [goal.accountId])),
    ),
  ];

  const [balances, contributionSums] = await Promise.all([
    Promise.all(
      accountIds.map(async (accountId) => {
        const { transactionCount, balance } = await readAccountBalance(
          workspace.id,
          accountId,
        );
        return [accountId, transactionCount === 0 ? null : balance] as const;
      }),
    ),
    sumGoalContributions(workspace.id),
  ]);
  const balanceByAccount = new Map(balances);

  const rows: GoalRow[] = goals.map((goal) => {
    const progress = computeGoalProgress(
      goal,
      goal.accountId === null ? null : (balanceByAccount.get(goal.accountId) ?? null),
      { contributionSum: contributionSums.get(goal.id)?.total ?? null },
    );

    return {
      name: goal.name,
      currency: goal.currency,
      targetAmount: goal.targetAmount.toFixed(2),
      targetDate: toDateOnlyString(goal.targetDate),
      status: goal.status,
      source: sourceLabel(goal),
      account: goal.accountName ?? "",
      ...numericCells(progress),
    };
  });

  const scope = scopeOf(window, "all");

  return {
    entity: "goals",
    csv: toCsv(rows, GOAL_COLUMNS),
    fileName:
      scope === "range" ? rangeFileName("objectifs", window.fromDay, window.toDay) : "objectifs.csv",
    rowCount: rows.length,
    truncated,
    scope,
    ...(scope === "range" ? { from: window.fromDay, to: window.toDay } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Alerts                                                                     */
/* -------------------------------------------------------------------------- */

type AlertRow = {
  kind: string;
  status: string;
  triggeredAt: string;
  lastSeenAt: string;
  dismissedAt: string;
  resolvedAt: string;
  reason: string;
};

const ALERT_COLUMNS: CsvColumn<AlertRow>[] = [
  { key: "kind", header: "type" },
  { key: "status", header: "statut" },
  { key: "triggeredAt", header: "declenchee_le" },
  { key: "lastSeenAt", header: "vue_le" },
  { key: "dismissedAt", header: "ecartee_le" },
  { key: "resolvedAt", header: "resolue_le" },
  { key: "reason", header: "raison" },
];

/**
 * Alert episodes, one row each.
 *
 * `status` filters the file; `from`/`to` apply to the **trigger instant**. A URL carries
 * no time zone, so those bounds are UTC calendar days: the file is unambiguous, which
 * matters more than matching the reader's local midnight.
 *
 * Nothing from a module inactive in the workspace is exported, and the reason is
 * recomputed from the stored inputs by the same `describeAlert` the screen uses.
 */
export async function exportAlerts(
  workspace: ActiveWorkspace,
  params: URLSearchParams,
): Promise<ExportFile> {
  const window = readWindow(params);
  const rawStatus = params.get("status");
  const status = ALERT_STATUSES.find((value) => value === rawStatus);

  const alerts = await listAlerts(workspace.id, {
    status,
    from: window.from,
    to: window.to,
    take: READ_LIMIT,
  });

  const visible = alerts.filter((alert) => isAlertVisible(alert.kind, workspace.modules));
  const rows: AlertRow[] = visible.slice(0, EXPORT_ROW_LIMIT).map((alert) => ({
    kind: alert.kind,
    status: alert.status,
    triggeredAt: alert.triggeredAt.toISOString(),
    lastSeenAt: alert.lastSeenAt.toISOString(),
    dismissedAt: alert.dismissedAt?.toISOString() ?? "",
    resolvedAt: alert.resolvedAt?.toISOString() ?? "",
    reason: describeAlert({ kind: alert.kind, inputs: alert.inputs }).reason,
  }));

  const scope = scopeOf(window, "all");

  return {
    entity: "alerts",
    csv: toCsv(rows, ALERT_COLUMNS),
    fileName:
      scope === "range" ? rangeFileName("alertes", window.fromDay, window.toDay) : "alertes.csv",
    rowCount: rows.length,
    // A read that reached the cap may hide visible episodes behind the hidden ones.
    truncated: alerts.length > EXPORT_ROW_LIMIT || visible.length > EXPORT_ROW_LIMIT,
    scope,
    ...(scope === "range" ? { from: window.fromDay, to: window.toDay } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                   */
/* -------------------------------------------------------------------------- */

export async function buildExport(
  entity: ExportEntity,
  workspace: ActiveWorkspace,
  params: URLSearchParams,
): Promise<ExportFile> {
  switch (entity) {
    case "transactions":
      return exportTransactions(workspace, params);
    case "properties":
      return exportProperties(workspace, params);
    case "budgets":
      return exportBudgets(workspace, params);
    case "goals":
      return exportGoals(workspace, params);
    case "alerts":
      return exportAlerts(workspace, params);
  }
}
