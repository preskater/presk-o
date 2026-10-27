import Decimal from "decimal.js";
import {
  currentMonthKey,
  monthRange,
  parseMonthKey,
  shiftMonthKey,
  toDateOnlyString,
} from "@/lib/dates";
import { resolveAlertRules } from "@/modules/alerts/domain";
import { listAlertRules } from "@/modules/alerts/repository";
import { resolveAccountFloor, suggestAccountFloor } from "./account-threshold";
import { plannedOccurrences } from "./recurrence";
import {
  findCategory,
  findSalarySetting,
  findTransactionByExternalRef,
  listAccountBalanceTotals,
  listAccountsForManagement,
  listBudgets,
  listRecurringEntries,
  listRecurringOccurrences,
  listSalaryRates,
  listTransactionsForSeries,
  listWorkDays,
  sumExpensesByAccount,
  sumTransactionsByAccount,
} from "./repository";
import {
  resolveSalaryRate,
  salaryBookingRef,
  salaryMonthContribution,
  type WorkDayRecord,
} from "./salary";
import {
  monthKeyOf,
  simulateExpense,
  simulationMonthKeys,
  type SimulationAccount,
  type SimulationBudgetInput,
  type SimulationForecastMovement,
  type SimulationMonthInput,
  type SimulationPayment,
  type SimulationRecordedMovement,
  type SimulationResult,
  type ValidatedExpenseSimulationInput,
} from "./simulation";

/**
 * Server-side assembly of an expense scenario.
 *
 * The action stays thin: this module validates the owner's identifiers, reads the
 * same rows the Prévisions and Suivi tabs read, and hands plain domain values to
 * the pure engine. It writes nothing.
 */

export type ExpenseSimulationFailure = {
  ok: false;
  field: string;
  message: string;
};

export type ExpenseSimulationOutcome =
  | { ok: true; result: SimulationResult }
  | ExpenseSimulationFailure;

function failure(field: string, message: string): ExpenseSimulationFailure {
  return { ok: false, field, message };
}

function endOfMonth(key: string): Date {
  const { year, month } = parseMonthKey(key);
  return new Date(monthRange(year, month).end.getTime() - 1);
}

/**
 * Runs the scenario for one workspace.
 *
 * `values` has already passed the shared zod contract; ownership and business
 * checks happen here, against the rows the signed-in workspace actually owns.
 */
export async function runExpenseSimulation(input: {
  workspaceId: string;
  values: ValidatedExpenseSimulationInput;
  now?: Date;
}): Promise<ExpenseSimulationOutcome> {
  const now = input.now ?? new Date();
  const values = input.values;

  const [allAccounts, category] = await Promise.all([
    listAccountsForManagement(input.workspaceId),
    values.categoryId
      ? findCategory(input.workspaceId, values.categoryId)
      : Promise.resolve(null),
  ]);

  if (values.categoryId && (!category || category.kind !== "EXPENSE")) {
    return failure(
      "categoryId",
      "La catégorie choisie n'existe pas ou n'est pas une catégorie de dépense.",
    );
  }

  const selectableAccounts = new Map(
    allAccounts
      .filter((account) => account.archivedAt === null)
      .map((account) => [account.id, account]),
  );

  for (const [index, payment] of values.payments.entries()) {
    if (!payment.amount.greaterThan(0)) {
      return failure(
        `payments.${index}.amount`,
        "Chaque paiement doit être supérieur à zéro.",
      );
    }

    if (payment.accountId === null) {
      continue;
    }

    const account = selectableAccounts.get(payment.accountId);
    if (!account) {
      return failure(
        `payments.${index}.accountId`,
        "Le compte choisi est introuvable ou archivé.",
      );
    }
    if (account.currency !== values.currency) {
      return failure(
        `payments.${index}.accountId`,
        `Le compte « ${account.name} » n'est pas dans la devise du scénario.`,
      );
    }
  }

  const activeCurrencyAccounts = [...selectableAccounts.values()].filter(
    (account) => account.currency === values.currency,
  );
  if (
    values.payments.some((payment) => payment.accountId === null) &&
    activeCurrencyAccounts.length === 0
  ) {
    return failure(
      "payments",
      `Aucun compte actif en ${values.currency} : impossible de proposer une répartition. Choisissez une autre devise ou créez un compte.`,
    );
  }

  const horizon = simulationMonthKeys(
    values.payments.map((payment) => ({ operationDate: payment.operationDate })),
    now,
  );
  const lastKey = horizon.keys[horizon.keys.length - 1];
  const outsideHorizon = values.payments.find(
    (payment) => monthKeyOf(payment.operationDate) > lastKey,
  );
  if (outsideHorizon) {
    return failure(
      "payments",
      "Un paiement dépasse l'horizon de simulation de 24 mois. Rapprochez sa date ou simulez-le séparément.",
    );
  }

  const firstKey = horizon.keys[0];
  const firstMonth = parseMonthKey(firstKey);
  const lastMonth = parseMonthKey(lastKey);
  const start = monthRange(firstMonth.year, firstMonth.month).start;
  const end = monthRange(lastMonth.year, lastMonth.month).end;
  const currentKey = currentMonthKey(now);
  const currentParsed = parseMonthKey(currentKey);
  const currentMonthStart = monthRange(currentParsed.year, currentParsed.month).start;
  const historyStartParsed = parseMonthKey(shiftMonthKey(currentKey, -3));
  const historyStart = monthRange(
    historyStartParsed.year,
    historyStartParsed.month,
  ).start;

  const [
    balances,
    expenseHistory,
    openingTotals,
    recordedWindow,
    entries,
    storedOccurrences,
    salarySetting,
    rates,
    workDays,
    salaryBookings,
    ruleRows,
    budgetMonths,
  ] = await Promise.all([
    listAccountBalanceTotals(input.workspaceId),
    sumExpensesByAccount(input.workspaceId, {
      from: historyStart,
      to: currentMonthStart,
    }),
    sumTransactionsByAccount(input.workspaceId, { before: start }),
    listTransactionsForSeries(input.workspaceId, { from: start, to: end }),
    listRecurringEntries(input.workspaceId),
    listRecurringOccurrences(input.workspaceId, { from: start, to: end }),
    findSalarySetting(input.workspaceId),
    listSalaryRates(input.workspaceId),
    listWorkDays(input.workspaceId, { from: start, to: end }),
    Promise.all(
      horizon.keys.map((key) => {
        const parsed = parseMonthKey(key);
        return findTransactionByExternalRef(
          input.workspaceId,
          salaryBookingRef(parsed.year, parsed.month),
        );
      }),
    ),
    listAlertRules(input.workspaceId),
    values.categoryId
      ? Promise.all(
          horizon.keys.map((key) => {
            const parsed = parseMonthKey(key);
            return listBudgets(input.workspaceId, {
              year: parsed.year,
              month: parsed.month,
            });
          }),
        )
      : Promise.resolve([]),
  ]);

  const balanceById = new Map(balances.map((balance) => [balance.accountId, balance]));
  const openingById = new Map(openingTotals);
  const currencyByAccount = new Map(
    allAccounts.map((account) => [account.id, account.currency]),
  );
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));

  const rules = resolveAlertRules(ruleRows);
  const lowBalance = rules.find((rule) => rule.kind === "LOW_BALANCE");
  const budgetThreshold = rules.find((rule) => rule.kind === "BUDGET_THRESHOLD");
  const budgetThresholdPercent =
    budgetThreshold?.enabled === true
      ? budgetThreshold.thresholdPercent ?? new Decimal(80)
      : null;

  const storedByRecurringDate = new Map(
    storedOccurrences.map((occurrence) => [
      `${occurrence.recurringId}|${toDateOnlyString(occurrence.date)}`,
      occurrence,
    ]),
  );

  const workDaysByMonth = new Map<string, WorkDayRecord[]>();
  for (const day of workDays) {
    const key = monthKeyOf(day.date);
    const bucket = workDaysByMonth.get(key) ?? [];
    bucket.push(day);
    workDaysByMonth.set(key, bucket);
  }

  const recordedByMonth = new Map<string, typeof recordedWindow.transactions>();
  for (const transaction of recordedWindow.transactions) {
    if (transaction.currency !== values.currency) {
      continue;
    }
    const key = monthKeyOf(transaction.operationDate);
    const bucket = recordedByMonth.get(key) ?? [];
    bucket.push(transaction);
    recordedByMonth.set(key, bucket);
  }

  const months: SimulationMonthInput[] = horizon.keys.map((key, index) => {
    const parsed = parseMonthKey(key);
    const monthTransactions = recordedByMonth.get(key) ?? [];
    const recorded: SimulationRecordedMovement[] = monthTransactions.map(
      (transaction) => ({
        accountId: transaction.accountId,
        currency: transaction.currency,
        amount: transaction.amount,
        date: transaction.operationDate,
      }),
    );
    const forecast: SimulationForecastMovement[] = [];

    for (const occurrence of plannedOccurrences(entries, parsed.year, parsed.month)) {
      const entry = entriesById.get(occurrence.recurringId);
      if (!entry) {
        continue;
      }

      const accountCurrency = currencyByAccount.get(entry.accountId);
      if (accountCurrency !== values.currency) {
        continue;
      }

      const stored = storedByRecurringDate.get(
        `${entry.id}|${toDateOnlyString(occurrence.date)}`,
      );
      if (stored && stored.status !== "PENDING") {
        continue;
      }

      forecast.push({
        accountId: entry.accountId,
        currency: accountCurrency,
        amount: entry.type === "EXPENSE" ? entry.amount.negated() : entry.amount,
        date: occurrence.date,
        label: entry.label,
      });
    }

    // A booked salary is already a recorded transaction of the month. Simulating it
    // again would count the same money twice, so the forecast only adds an unbooked
    // month whose calendar has been clicked.
    if (!salaryBookings[index] && salarySetting) {
      const rate = resolveSalaryRate(rates, parsed.year, parsed.month);
      const days = workDaysByMonth.get(key) ?? [];
      const contribution = salaryMonthContribution({
        rate:
          rate && salarySetting.currency === values.currency
            ? { hourlyRate: rate.hourlyRate, currency: salarySetting.currency }
            : null,
        days,
        booking: null,
      });

      if (contribution && contribution.currency === values.currency) {
        forecast.push({
          accountId: null,
          currency: contribution.currency,
          amount: contribution.amount,
          date: days[days.length - 1]?.date ?? endOfMonth(key),
          label: "Salaire simulé",
        });
      }
    }

    const budgets: SimulationBudgetInput[] = (budgetMonths[index] ?? [])
      .filter(
        (budget) =>
          budget.categoryId === values.categoryId &&
          budget.currency === values.currency,
      )
      .map((budget) => {
        const actualBefore = monthTransactions.reduce((sum, transaction) => {
          if (
            transaction.type === "TRANSFER" ||
            transaction.categoryId !== budget.categoryId
          ) {
            return sum;
          }
          return sum.plus(
            transaction.type === "EXPENSE"
              ? transaction.amount.negated()
              : transaction.amount,
          );
        }, new Decimal(0));

        return {
          categoryId: budget.categoryId,
          currency: budget.currency,
          planned: budget.amount,
          actualBefore,
          thresholdPercent: budgetThresholdPercent,
        };
      });

    return { key, recorded, forecast, budgets };
  });

  const payments: SimulationPayment[] = values.payments.map((payment) => ({
    accountId: payment.accountId,
    amount: payment.amount,
    date: payment.operationDate,
    label: values.label,
  }));

  const currentMonthPlan = months.find((month) => month.key === currentKey);
  const pendingExpensesByAccount = new Map<string, Decimal>();
  for (const movement of currentMonthPlan?.forecast ?? []) {
    if (movement.accountId && movement.amount.isNegative()) {
      pendingExpensesByAccount.set(
        movement.accountId,
        (pendingExpensesByAccount.get(movement.accountId) ?? new Decimal(0)).plus(
          movement.amount.abs(),
        ),
      );
    }
  }

  const accounts: SimulationAccount[] = allAccounts
    .filter((account) => account.currency === values.currency)
    .map((account) => {
      const total = balanceById.get(account.id);
      const known = (total?.transactionCount ?? 0) > 0;
      const opening = openingById.get(account.id);

      const suggested = suggestAccountFloor({
        expensesLastThreeMonths:
          expenseHistory.get(account.id) ?? new Decimal(0),
        pendingExpenses:
          pendingExpensesByAccount.get(account.id) ?? new Decimal(0),
      });
      const globalThreshold =
        lowBalance?.enabled &&
        lowBalance.thresholdAmount !== null &&
        lowBalance.thresholdAmount.greaterThan(0) &&
        (lowBalance.thresholdCurrency === null ||
          lowBalance.thresholdCurrency === account.currency)
          ? lowBalance.thresholdAmount
          : null;
      const { floor, source: floorSource } = resolveAccountFloor({
        configured: account.lowBalanceThreshold,
        global: globalThreshold,
        suggested,
      });

      return {
        id: account.id,
        name: account.name,
        type: account.type,
        currency: account.currency,
        archived: account.archivedAt !== null,
        recordedBalance: known ? total!.balance : null,
        openingBalance: known ? opening?.balance ?? new Decimal(0) : null,
        floor,
        floorSource,
      };
    });

  const hasForecast = months.some((month) => month.forecast.length > 0);
  const forecastWarnings: string[] = [];
  if (!hasForecast) {
    forecastWarnings.push(
      "Aucune échéance en attente ni salaire simulé dans cette devise sur l'horizon : les projections reposent uniquement sur les opérations déjà enregistrées.",
    );
  } else if (salarySetting && rates.length === 0) {
    forecastWarnings.push(
      "Aucun taux horaire n'est configuré : le salaire simulé n'est pas inclus dans les projections.",
    );
  } else if (salarySetting && salarySetting.currency !== values.currency) {
    forecastWarnings.push(
      `La simulation de salaire est configurée en ${salarySetting.currency} : elle n'est pas incluse dans ce scénario en ${values.currency}. Aucune conversion n'est faite.`,
    );
  } else if (salarySetting && workDays.length === 0) {
    forecastWarnings.push(
      "Aucun jour de salaire n'est planifié sur l'horizon : le salaire simulé n'est pas inclus. Planifiez des jours dans l'onglet Salaire pour l'ajouter aux projections.",
    );
  }

  const result = simulateExpense({
    currency: values.currency,
    currentMonthKey: currentKey,
    accounts,
    months,
    payments,
    selectedCategory: category
      ? { id: category.id, name: category.name }
      : null,
    recordedWindowTruncated: recordedWindow.truncated,
    horizonCapped: horizon.capped,
    forecastWarnings,
  });

  return { ok: true, result };
}
