import Decimal from "decimal.js";
import { z } from "zod";
import {
  formatMonthLabel,
  monthKeysFrom,
  monthRange,
  parseMonthKey,
  shiftMonthKey,
  toDateOnlyString,
} from "@/lib/dates";
import type { Currency } from "@/lib/money";
import {
  amount,
  currencyCode,
  optionalId,
  optionalText,
  requiredDate,
} from "@/lib/validation";

/**
 * "Simulate an expense": a non-persistent scenario over the owner's recorded
 * operations and the forecasts the Prévisions tab already computes.
 *
 * Rules, documented because an undocumented indicator is not verifiable:
 *
 * - Nothing is written. The simulation reads the ledger and the forecasting rules,
 *   then returns figures for display only.
 * - The horizon starts at the current month. A payment dated earlier extends the
 *   window backwards; a payment dated later extends it forwards. Seven months are
 *   always shown (the current month and the next six), and three months follow the
 *   last payment so its aftermath is visible. The window is capped at 24 months and
 *   the cap is reported.
 * - A month's `balance before scenario` is its opening balance plus the recorded
 *   operations and the pending forecasts dated in that month. `balance after scenario`
 *   adds the simulated payments. A confirmed forecast is already a recorded
 *   transaction, so it is never counted twice.
 * - The salary simulation is a currency-level forecast: no account owns it before it
 *   is booked. It therefore advances the global balance, not an account balance.
 * - An account with no recorded operation has an **unknown** balance, never zero: its
 *   projections stay empty while forecasts are still counted in the global figure.
 * - Currencies are never converted. The engine handles one currency; the caller
 *   validates that every selected account uses it.
 * - A threshold is the configured `LOW_BALANCE` rule. It applies to an account's
 *   currency when the rule names one, and to every currency when it names none. A
 *   balance below zero is reported even when no threshold is configured.
 * - Budget impact is computed only when the caller names a category: actuals follow
 *   the Suivi rules (expenses positive, refunds reducing them, transfers and
 *   uncategorised rows excluded). A month without a budget is "no budget", not zero.
 */

export const HORIZON_MINIMUM_MONTHS = 7;
export const HORIZON_MAXIMUM_MONTHS = 24;
export const HORIZON_AFTER_LAST_PAYMENT_MONTHS = 3;

export const expenseSimulationPaymentSchema = z.object({
  accountId: z.string().trim().min(1, "Un compte est requis."),
  amount,
  operationDate: requiredDate,
});

export const expenseSimulationSchema = z.object({
  label: optionalText(200, "Le libellé est limité à 200 caractères."),
  currency: currencyCode,
  categoryId: optionalId,
  payments: z
    .array(expenseSimulationPaymentSchema)
    .min(1, "Au moins un paiement est requis."),
});

export type ExpenseSimulationInput = z.input<typeof expenseSimulationSchema>;
export type ValidatedExpenseSimulationInput = z.output<typeof expenseSimulationSchema>;

export type SimulationVerdict = "safe" | "breach" | "negative" | "unknown";
export type BudgetImpactStatus = "ok" | "warning" | "overrun" | "none";

export type SimulationAccount = {
  id: string;
  name: string;
  currency: Currency;
  archived: boolean;
  /** All-time recorded signed sum; null when the account holds no operation. */
  recordedBalance: Decimal | null;
  /** Signed sum strictly before the horizon; null when the balance is unknown. */
  openingBalance: Decimal | null;
};

export type SimulationRecordedMovement = {
  accountId: string;
  currency: Currency;
  amount: Decimal;
  date: Date;
};

export type SimulationForecastMovement = {
  /** Null for a currency-level forecast such as the simulated salary. */
  accountId: string | null;
  currency: Currency;
  /** Signed amount: income positive, expense negative. */
  amount: Decimal;
  date: Date;
  label: string;
};

export type SimulationPayment = {
  accountId: string;
  amount: Decimal;
  date: Date;
  label: string | null;
};

export type SimulationBudgetInput = {
  categoryId: string;
  currency: Currency;
  planned: Decimal;
  actualBefore: Decimal;
  /** Null when the preventive `BUDGET_THRESHOLD` rule is disabled. */
  thresholdPercent: Decimal | null;
};

export type SimulationMonthInput = {
  key: string;
  recorded: readonly SimulationRecordedMovement[];
  forecast: readonly SimulationForecastMovement[];
  budgets: readonly SimulationBudgetInput[];
};

export type SimulationThreshold = {
  enabled: boolean;
  amount: Decimal;
  /** Null means the rule applies to every currency. */
  currency: Currency | null;
};

export type SimulationInput = {
  currency: Currency;
  currentMonthKey: string;
  accounts: readonly SimulationAccount[];
  months: readonly SimulationMonthInput[];
  payments: readonly SimulationPayment[];
  threshold: SimulationThreshold | null;
  selectedCategory: { id: string; name: string } | null;
  recordedWindowTruncated: boolean;
  horizonCapped: boolean;
  forecastWarnings: readonly string[];
};

export type SimulationPaymentResult = {
  index: number;
  accountId: string;
  accountName: string;
  currency: Currency;
  amount: Decimal;
  operationDate: Date;
  balanceBefore: Decimal | null;
  balanceAfter: Decimal | null;
  globalBalanceAfter: Decimal | null;
  accountCumulative: Decimal;
  thresholdBreached: boolean | null;
  thresholdCausedByScenario: boolean;
};

export type SimulationMonthResult = {
  key: string;
  label: string;
  recordedCount: number;
  forecastCount: number;
  paymentCount: number;
  recordedNet: Decimal;
  forecastIncome: Decimal;
  forecastExpense: Decimal;
  forecastNet: Decimal;
  simulatedExpense: Decimal;
  balanceBeforeScenario: Decimal | null;
  balanceAfterScenario: Decimal | null;
  delta: Decimal;
  thresholdBreachCount: number;
  globalNegative: boolean;
};

export type SimulationAccountResult = {
  id: string;
  name: string;
  currency: Currency;
  archived: boolean;
  recordedBalance: Decimal | null;
  paymentsTotal: Decimal;
  currentMonthEndBefore: Decimal | null;
  currentMonthEndAfter: Decimal | null;
  lowestAfter: Decimal | null;
  lowestMonth: string | null;
  thresholdBreached: boolean | null;
  thresholdCausedByScenario: boolean;
  firstBreachMonth: string | null;
};

export type SimulationThresholdBreach = {
  accountId: string;
  accountName: string;
  monthKey: string;
  amount: Decimal;
  causedByScenario: boolean;
};

export type SimulationSummary = {
  verdict: SimulationVerdict;
  totalAmount: Decimal;
  recordedBalance: Decimal | null;
  currentMonthKey: string;
  currentMonthEndBefore: Decimal | null;
  currentMonthEndAfter: Decimal | null;
  currentMonthDelta: Decimal;
  lowestProjected: Decimal | null;
  lowestProjectedMonth: string | null;
  lowestAccount: {
    accountId: string;
    accountName: string;
    amount: Decimal;
    monthKey: string;
  } | null;
  firstThresholdBreach: SimulationThresholdBreach | null;
  globalNegativeMonth: string | null;
  threshold: { amount: Decimal; currency: Currency | null } | null;
};

export type SimulationBudgetRow = {
  key: string;
  label: string;
  planned: Decimal | null;
  actualBefore: Decimal;
  simulatedExpense: Decimal;
  actualAfter: Decimal;
  remainingBefore: Decimal | null;
  remainingAfter: Decimal | null;
  status: BudgetImpactStatus;
};

export type SimulationBudgetImpact = {
  categoryId: string;
  categoryName: string;
  currency: Currency;
  hasBudget: boolean;
  rows: SimulationBudgetRow[];
};

export type SimulationResult = {
  currency: Currency;
  totalAmount: Decimal;
  horizon: { startKey: string; endKey: string; capped: boolean };
  summary: SimulationSummary;
  months: SimulationMonthResult[];
  accounts: SimulationAccountResult[];
  payments: SimulationPaymentResult[];
  budget: SimulationBudgetImpact | null;
  warnings: string[];
};

/**
 * The months a scenario covers.
 *
 * The current month is always included. Seven months are the minimum, so the
 * question "what happens to the following months" has an answer even for a
 * one-off payment. Past and future payment dates widen the window, and three
 * months follow the last payment; 24 months is the hard bound.
 */
export function simulationMonthKeys(
  payments: readonly { operationDate: Date }[],
  now: Date = new Date(),
): { keys: string[]; capped: boolean } {
  const current = now.toISOString().slice(0, 7);
  const paymentKeys = payments.map((payment) => toDateOnlyString(payment.operationDate).slice(0, 7));
  const earliest = paymentKeys.reduce(
    (minimum, key) => (key < minimum ? key : minimum),
    current,
  );
  const latest = paymentKeys.reduce((maximum, key) => (key > maximum ? key : maximum), current);
  const minimumEnd = shiftMonthKey(current, HORIZON_MINIMUM_MONTHS - 1);
  const afterLastPayment = shiftMonthKey(latest, HORIZON_AFTER_LAST_PAYMENT_MONTHS);
  const requestedEnd = afterLastPayment > minimumEnd ? afterLastPayment : minimumEnd;
  const maximumEnd = shiftMonthKey(earliest, HORIZON_MAXIMUM_MONTHS - 1);
  const capped = requestedEnd > maximumEnd;
  const end = capped ? maximumEnd : requestedEnd;
  const count = monthDistance(earliest, end) + 1;

  return { keys: monthKeysFrom(earliest, count), capped };
}

function monthDistance(from: string, to: string): number {
  const start = parseMonthKey(from);
  const end = parseMonthKey(to);
  return (end.year - start.year) * 12 + (end.month - start.month);
}

export function monthKeyOf(date: Date): string {
  return toDateOnlyString(date).slice(0, 7);
}

function monthLabelOf(key: string): string {
  const { year, month } = parseMonthKey(key);
  return formatMonthLabel(year, month);
}

function monthEnd(key: string): Date {
  const { year, month } = parseMonthKey(key);
  return new Date(monthRange(year, month).end.getTime() - 1);
}

function sortRank(kind: "recorded" | "forecast" | "payment"): number {
  return kind === "recorded" ? 0 : kind === "forecast" ? 1 : 2;
}

type TimelineEvent =
  | {
      kind: "recorded";
      date: Date;
      accountId: string;
      amount: Decimal;
    }
  | {
      kind: "forecast";
      date: Date;
      accountId: string | null;
      amount: Decimal;
    }
  | {
      kind: "payment";
      date: Date;
      accountId: string;
      amount: Decimal;
      index: number;
    };

type AccountState = {
  account: SimulationAccount;
  withScenario: Decimal | null;
  withoutScenario: Decimal | null;
  lowestWith: Decimal | null;
  lowestMonth: string | null;
  firstBreachWith: { monthKey: string; time: number; amount: Decimal } | null;
  firstBreachWithout: { monthKey: string; time: number; amount: Decimal } | null;
  endOfMonthWith: Map<string, Decimal | null>;
  endOfMonthWithout: Map<string, Decimal | null>;
};

function addKnown(value: Decimal | null, delta: Decimal): Decimal | null {
  return value === null ? null : value.plus(delta);
}

function trackLowest(
  state: AccountState,
  balance: Decimal | null,
  key: string,
): void {
  if (balance === null) {
    return;
  }

  if (state.lowestWith === null || balance.lessThan(state.lowestWith)) {
    state.lowestWith = balance;
    state.lowestMonth = key;
  }
}

function trackBreach(
  state: AccountState,
  balance: Decimal | null,
  threshold: Decimal | null,
  key: string,
  time: number,
  target: "with" | "without",
): void {
  if (balance === null || threshold === null || !balance.lessThan(threshold)) {
    return;
  }

  if (target === "with" && state.firstBreachWith === null) {
    state.firstBreachWith = { monthKey: key, time, amount: balance };
  }
  if (target === "without" && state.firstBreachWithout === null) {
    state.firstBreachWithout = { monthKey: key, time, amount: balance };
  }
}

/**
 * The scenario, from recorded rows, forecasts and the payments the owner typed.
 *
 * Pure: every amount and every date is handed in, so the same inputs always
 * produce the same figures and the tests need no database.
 */
export function simulateExpense(input: SimulationInput): SimulationResult {
  const accountById = new Map(input.accounts.map((account) => [account.id, account]));
  const thresholdAmount =
    input.threshold?.enabled &&
    (input.threshold.currency === null || input.threshold.currency === input.currency)
      ? input.threshold.amount
      : null;

  for (const payment of input.payments) {
    const account = accountById.get(payment.accountId);
    if (!account) {
      throw new Error("Simulation account is not available.");
    }
    if (account.currency !== input.currency) {
      throw new Error("A simulation account uses another currency.");
    }
  }

  const paymentsByMonth = new Map<string, { payment: SimulationPayment; index: number }[]>();
  input.payments.forEach((payment, index) => {
    const key = monthKeyOf(payment.date);
    const bucket = paymentsByMonth.get(key) ?? [];
    bucket.push({ payment, index });
    paymentsByMonth.set(key, bucket);
  });

  const states = new Map<string, AccountState>();
  const knownOpenings: Decimal[] = [];
  const firstMonthKey = input.months[0]?.key ?? input.currentMonthKey;
  const openingTime = parseMonthKey(firstMonthKey);
  const startTime = monthRange(openingTime.year, openingTime.month).start.getTime();

  for (const account of input.accounts) {
    if (account.openingBalance !== null) {
      knownOpenings.push(account.openingBalance);
    }
    const alreadyBelow =
      account.openingBalance !== null &&
      thresholdAmount !== null &&
      account.openingBalance.lessThan(thresholdAmount);
    states.set(account.id, {
      account,
      withScenario: account.openingBalance,
      withoutScenario: account.openingBalance,
      lowestWith: account.openingBalance,
      lowestMonth: account.openingBalance === null ? null : firstMonthKey,
      firstBreachWith: alreadyBelow
        ? { monthKey: firstMonthKey, time: startTime, amount: account.openingBalance! }
        : null,
      firstBreachWithout: alreadyBelow
        ? { monthKey: firstMonthKey, time: startTime, amount: account.openingBalance! }
        : null,
      endOfMonthWith: new Map(),
      endOfMonthWithout: new Map(),
    });
  }

  let globalWith: Decimal | null =
    knownOpenings.length > 0
      ? knownOpenings.reduce((sum, value) => sum.plus(value), new Decimal(0))
      : null;
  let globalWithout = globalWith;
  let lowestProjected: Decimal | null = globalWith;
  let lowestProjectedMonth: string | null = globalWith === null ? null : input.currentMonthKey;
  let globalNegativeMonth: string | null = null;

  const paymentResults: SimulationPaymentResult[] = [];
  const cumulativeByAccount = new Map<string, Decimal>();
  const monthResults: SimulationMonthResult[] = [];

  for (const month of input.months) {
    const events: TimelineEvent[] = [
      ...month.recorded.map((movement) => ({
        kind: "recorded" as const,
        date: movement.date,
        accountId: movement.accountId,
        amount: movement.amount,
      })),
      ...month.forecast.map((movement) => ({
        kind: "forecast" as const,
        date: movement.date,
        accountId: movement.accountId,
        amount: movement.amount,
      })),
      ...(paymentsByMonth.get(month.key) ?? []).map(({ payment, index }) => ({
        kind: "payment" as const,
        date: payment.date,
        accountId: payment.accountId,
        amount: payment.amount.negated(),
        index,
      })),
    ].sort(
      (left, right) =>
        left.date.getTime() - right.date.getTime() ||
        sortRank(left.kind) - sortRank(right.kind) ||
        ("index" in left ? left.index : 0) - ("index" in right ? right.index : 0),
    );

    let recordedCount = 0;
    let forecastCount = 0;
    let paymentCount = 0;
    let recordedNet = new Decimal(0);
    let forecastIncome = new Decimal(0);
    let forecastExpense = new Decimal(0);
    let simulatedExpense = new Decimal(0);

    for (const event of events) {
      if (event.kind === "recorded") {
        recordedCount += 1;
        recordedNet = recordedNet.plus(event.amount);
        const state = states.get(event.accountId);
        if (state) {
          state.withScenario = addKnown(state.withScenario, event.amount);
          state.withoutScenario = addKnown(state.withoutScenario, event.amount);
          trackLowest(state, state.withScenario, month.key);
          trackBreach(
            state,
            state.withScenario,
            thresholdAmount,
            month.key,
            event.date.getTime(),
            "with",
          );
          trackBreach(
            state,
            state.withoutScenario,
            thresholdAmount,
            month.key,
            event.date.getTime(),
            "without",
          );
        }
        globalWith = addKnown(globalWith, event.amount);
        globalWithout = addKnown(globalWithout, event.amount);
        continue;
      }

      if (event.kind === "forecast") {
        forecastCount += 1;
        if (event.amount.greaterThan(0)) {
          forecastIncome = forecastIncome.plus(event.amount);
        } else if (event.amount.lessThan(0)) {
          forecastExpense = forecastExpense.plus(event.amount.abs());
        }

        if (event.accountId) {
          const state = states.get(event.accountId);
          if (state) {
            state.withScenario = addKnown(state.withScenario, event.amount);
            state.withoutScenario = addKnown(state.withoutScenario, event.amount);
            trackLowest(state, state.withScenario, month.key);
            trackBreach(
              state,
              state.withScenario,
              thresholdAmount,
              month.key,
              event.date.getTime(),
              "with",
            );
            trackBreach(
              state,
              state.withoutScenario,
              thresholdAmount,
              month.key,
              event.date.getTime(),
              "without",
            );
          }
        }
        globalWith = addKnown(globalWith, event.amount);
        globalWithout = addKnown(globalWithout, event.amount);
        continue;
      }

      const state = states.get(event.accountId);
      const account = accountById.get(event.accountId);
      if (!state || !account) {
        continue;
      }

      const balanceBefore = state.withScenario;
      const balanceBeforeBreached =
        balanceBefore !== null &&
        thresholdAmount !== null &&
        balanceBefore.lessThan(thresholdAmount);

      paymentCount += 1;
      simulatedExpense = simulatedExpense.plus(event.amount.abs());
      cumulativeByAccount.set(
        event.accountId,
        (cumulativeByAccount.get(event.accountId) ?? new Decimal(0)).plus(event.amount.abs()),
      );
      state.withScenario = addKnown(state.withScenario, event.amount);
      globalWith = addKnown(globalWith, event.amount);
      trackLowest(state, state.withScenario, month.key);
      trackBreach(
        state,
        state.withScenario,
        thresholdAmount,
        month.key,
        event.date.getTime(),
        "with",
      );

      const balanceAfterBreached =
        state.withScenario !== null &&
        thresholdAmount !== null &&
        state.withScenario.lessThan(thresholdAmount);

      paymentResults.push({
        index: event.index,
        accountId: event.accountId,
        accountName: account.name,
        currency: account.currency,
        amount: event.amount.abs(),
        operationDate: event.date,
        balanceBefore,
        balanceAfter: state.withScenario,
        globalBalanceAfter: globalWith,
        accountCumulative: cumulativeByAccount.get(event.accountId) ?? new Decimal(0),
        thresholdBreached:
          thresholdAmount === null || state.withScenario === null
            ? null
            : balanceAfterBreached,
        thresholdCausedByScenario: !balanceBeforeBreached && balanceAfterBreached,
      });
    }

    const endTime = monthEnd(month.key).getTime();
    let thresholdBreachCount = 0;

    for (const state of states.values()) {
      state.endOfMonthWith.set(month.key, state.withScenario);
      state.endOfMonthWithout.set(month.key, state.withoutScenario);
      trackLowest(state, state.withScenario, month.key);
      trackBreach(state, state.withScenario, thresholdAmount, month.key, endTime, "with");
      trackBreach(
        state,
        state.withoutScenario,
        thresholdAmount,
        month.key,
        endTime,
        "without",
      );

      if (
        thresholdAmount !== null &&
        state.withScenario !== null &&
        state.withScenario.lessThan(thresholdAmount)
      ) {
        thresholdBreachCount += 1;
      }
    }

    if (globalWith !== null) {
      if (lowestProjected === null || globalWith.lessThan(lowestProjected)) {
        lowestProjected = globalWith;
        lowestProjectedMonth = month.key;
      }
      if (globalWith.lessThan(0) && globalNegativeMonth === null) {
        globalNegativeMonth = month.key;
      }
    }

    monthResults.push({
      key: month.key,
      label: monthLabelOf(month.key),
      recordedCount,
      forecastCount,
      paymentCount,
      recordedNet,
      forecastIncome,
      forecastExpense,
      forecastNet: forecastIncome.minus(forecastExpense),
      simulatedExpense,
      balanceBeforeScenario: globalWithout,
      balanceAfterScenario: globalWith,
      delta: simulatedExpense.negated(),
      thresholdBreachCount,
      globalNegative: globalWith !== null && globalWith.lessThan(0),
    });
  }

  const accountResults: SimulationAccountResult[] = input.accounts.map((account) => {
    const state = states.get(account.id);
    const firstBreach = state?.firstBreachWith ?? null;
    const withoutBreach = state?.firstBreachWithout ?? null;
    const causedByScenario =
      firstBreach !== null &&
      (withoutBreach === null || firstBreach.time < withoutBreach.time);

    return {
      id: account.id,
      name: account.name,
      currency: account.currency,
      archived: account.archived,
      recordedBalance: account.recordedBalance,
      paymentsTotal: cumulativeByAccount.get(account.id) ?? new Decimal(0),
      currentMonthEndBefore: state?.endOfMonthWithout.get(input.currentMonthKey) ?? null,
      currentMonthEndAfter: state?.endOfMonthWith.get(input.currentMonthKey) ?? null,
      lowestAfter: state?.lowestWith ?? null,
      lowestMonth: state?.lowestMonth ?? null,
      thresholdBreached:
        account.openingBalance === null || thresholdAmount === null
          ? null
          : firstBreach !== null,
      thresholdCausedByScenario: causedByScenario,
      firstBreachMonth: firstBreach?.monthKey ?? null,
    };
  });

  const breachCandidates = accountResults
    .filter((account) => account.firstBreachMonth !== null)
    .map((account) => {
      const state = states.get(account.id);
      return {
        account,
        breach: state?.firstBreachWith ?? null,
        without: state?.firstBreachWithout ?? null,
      };
    })
    .filter((entry): entry is { account: SimulationAccountResult; breach: NonNullable<AccountState["firstBreachWith"]>; without: AccountState["firstBreachWithout"] } => entry.breach !== null)
    .sort(
      (left, right) =>
        left.breach.time - right.breach.time ||
        left.account.name.localeCompare(right.account.name),
    );

  const firstThresholdBreach: SimulationThresholdBreach | null =
    breachCandidates.length > 0
      ? {
          accountId: breachCandidates[0].account.id,
          accountName: breachCandidates[0].account.name,
          monthKey: breachCandidates[0].breach.monthKey,
          amount: breachCandidates[0].breach.amount,
          causedByScenario:
            breachCandidates[0].without === null ||
            breachCandidates[0].breach.time < breachCandidates[0].without.time,
        }
      : null;

  const lowestAccountEntry = accountResults
    .filter(
      (account): account is SimulationAccountResult & { lowestAfter: Decimal; lowestMonth: string } =>
        account.lowestAfter !== null && account.lowestMonth !== null,
    )
    .sort((left, right) => left.lowestAfter.comparedTo(right.lowestAfter))[0];

  const negativeAccounts = accountResults.filter(
    (account) => account.lowestAfter !== null && account.lowestAfter.lessThan(0),
  );

  const currentMonth = monthResults.find((month) => month.key === input.currentMonthKey);
  const currentMonthPayments = input.payments
    .filter((payment) => monthKeyOf(payment.date) === input.currentMonthKey)
    .reduce((sum, payment) => sum.plus(payment.amount), new Decimal(0));
  const recordedBalance =
    input.accounts.some((account) => account.recordedBalance !== null)
      ? input.accounts.reduce(
          (sum, account) => sum.plus(account.recordedBalance ?? 0),
          new Decimal(0),
        )
      : null;

  const touchedAccounts = new Set(input.payments.map((payment) => payment.accountId));
  const unknownTouched = input.accounts.some(
    (account) =>
      touchedAccounts.has(account.id) && account.openingBalance === null,
  );
  const verdict: SimulationVerdict =
    firstThresholdBreach !== null ||
    globalNegativeMonth !== null ||
    negativeAccounts.length > 0
      ? "breach"
      : recordedBalance === null || unknownTouched
        ? "unknown"
        : "safe";

  const summary: SimulationSummary = {
    verdict,
    totalAmount: input.payments.reduce(
      (sum, payment) => sum.plus(payment.amount),
      new Decimal(0),
    ),
    recordedBalance,
    currentMonthKey: input.currentMonthKey,
    currentMonthEndBefore: currentMonth?.balanceBeforeScenario ?? null,
    currentMonthEndAfter: currentMonth?.balanceAfterScenario ?? null,
    currentMonthDelta: currentMonthPayments.negated(),
    lowestProjected,
    lowestProjectedMonth,
    lowestAccount: lowestAccountEntry
      ? {
          accountId: lowestAccountEntry.id,
          accountName: lowestAccountEntry.name,
          amount: lowestAccountEntry.lowestAfter,
          monthKey: lowestAccountEntry.lowestMonth,
        }
      : null,
    firstThresholdBreach,
    globalNegativeMonth,
    threshold:
      input.threshold?.enabled && thresholdAmount !== null
        ? { amount: input.threshold.amount, currency: input.threshold.currency }
        : null,
  };

  const warnings = new Set<string>(input.forecastWarnings);
  if (input.recordedWindowTruncated) {
    warnings.add(
      "L'historique de la période dépasse la limite de lecture : les projections peuvent être partielles.",
    );
  }
  const unknownTouchedAccounts = input.accounts.filter(
    (account) => touchedAccounts.has(account.id) && account.openingBalance === null,
  );
  if (unknownTouchedAccounts.length > 0) {
    warnings.add(
      `Le solde de ${unknownTouchedAccounts.length} compte${unknownTouchedAccounts.length > 1 ? "s" : ""} sélectionné${unknownTouchedAccounts.length > 1 ? "s" : ""} est inconnu : ses projections restent vides et le résultat global peut être partiel.`,
    );
  }
  if (firstThresholdBreach && !firstThresholdBreach.causedByScenario) {
    warnings.add(
      `Le seuil de solde bas est franchi même sans ce scénario (premier mois : ${monthLabelOf(firstThresholdBreach.monthKey)}). La dépense peut aggraver la situation, mais elle ne crée pas ce franchissement.`,
    );
  }
  if (negativeAccounts.length > 0 && thresholdAmount === null) {
    warnings.add(
      `Au moins un compte devient négatif sur l'horizon (${negativeAccounts
        .map((account) => account.name)
        .join(", ")}), alors qu'aucun seuil de solde bas ne s'applique à cette devise.`,
    );
  }
  if (input.horizonCapped) {
    warnings.add(
      `L'horizon est limité à ${HORIZON_MAXIMUM_MONTHS} mois : les paiements au-delà ne sont pas projetés.`,
    );
  }
  if (recordedBalance === null) {
    warnings.add(
      "Aucune opération n'est enregistrée dans cette devise : le solde de départ est inconnu et aucune projection chiffrée n'est possible.",
    );
  }

  return {
    currency: input.currency,
    totalAmount: summary.totalAmount,
    horizon: {
      startKey: input.months[0]?.key ?? input.currentMonthKey,
      endKey: input.months[input.months.length - 1]?.key ?? input.currentMonthKey,
      capped: input.horizonCapped,
    },
    summary,
    months: monthResults,
    accounts: accountResults,
    payments: paymentResults.sort(
      (left, right) =>
        left.operationDate.getTime() - right.operationDate.getTime() ||
        left.index - right.index,
    ),
    budget: buildBudgetImpact(input),
    warnings: [...warnings],
  };
}

function buildBudgetImpact(input: SimulationInput): SimulationBudgetImpact | null {
  if (!input.selectedCategory) {
    return null;
  }

  const paymentsByMonth = new Map<string, Decimal>();
  for (const payment of input.payments) {
    const key = monthKeyOf(payment.date);
    paymentsByMonth.set(
      key,
      (paymentsByMonth.get(key) ?? new Decimal(0)).plus(payment.amount),
    );
  }

  let hasBudget = false;
  const rows: SimulationBudgetRow[] = input.months.map((month) => {
    const budget = month.budgets.find(
      (entry) =>
        entry.categoryId === input.selectedCategory?.id &&
        entry.currency === input.currency,
    );
    const simulatedExpense = paymentsByMonth.get(month.key) ?? new Decimal(0);
    const actualBefore = budget?.actualBefore ?? new Decimal(0);
    const actualAfter = actualBefore.plus(simulatedExpense);

    if (!budget) {
      return {
        key: month.key,
        label: monthLabelOf(month.key),
        planned: null,
        actualBefore,
        simulatedExpense,
        actualAfter,
        remainingBefore: null,
        remainingAfter: null,
        status: "none" as const,
      };
    }

    hasBudget = true;
    const remainingBefore = budget.planned.minus(actualBefore);
    const remainingAfter = budget.planned.minus(actualAfter);
    const warningLine = budget.thresholdPercent
      ? budget.planned.times(budget.thresholdPercent).dividedBy(100)
      : null;
    const status: BudgetImpactStatus = actualAfter.greaterThan(budget.planned)
      ? "overrun"
      : warningLine !== null && actualAfter.greaterThanOrEqualTo(warningLine)
        ? "warning"
        : "ok";

    return {
      key: month.key,
      label: monthLabelOf(month.key),
      planned: budget.planned,
      actualBefore,
      simulatedExpense,
      actualAfter,
      remainingBefore,
      remainingAfter,
      status,
    };
  });

  return {
    categoryId: input.selectedCategory.id,
    categoryName: input.selectedCategory.name,
    currency: input.currency,
    hasBudget,
    rows,
  };
}
