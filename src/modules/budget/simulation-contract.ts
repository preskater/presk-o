import type { Currency } from "@/lib/money";
import type {
  BudgetImpactStatus,
  SimulationFloorSource,
  SimulationResult,
  SimulationVerdict,
} from "./simulation";

/**
 * Wire shape of a simulation.
 *
 * Decimal and Date objects cannot cross the Server Action boundary. The serialiser
 * turns every amount into its two-decimal string form and every calendar day into
 * `YYYY-MM-DD`, so the client never re-parses a locale-formatted value.
 */
export type SerializedSimulationResult = {
  currency: Currency;
  totalAmount: string;
  horizon: { startKey: string; endKey: string; capped: boolean };
  summary: {
    verdict: SimulationVerdict;
    totalAmount: string;
    recordedBalance: string | null;
    currentMonthKey: string;
    currentMonthEndBefore: string | null;
    currentMonthEndAfter: string | null;
    currentMonthDelta: string;
    lowestProjected: string | null;
    lowestProjectedMonth: string | null;
    lowestAccount: {
      accountId: string;
      accountName: string;
      amount: string;
      monthKey: string;
    } | null;
    firstThresholdBreach: {
      accountId: string;
      accountName: string;
      monthKey: string;
      amount: string;
      floor: string;
      floorSource: SimulationFloorSource;
      causedByScenario: boolean;
    } | null;
    globalNegativeMonth: string | null;
    thresholds: {
      accountCount: number;
      configuredCount: number;
      globalCount: number;
      suggestedCount: number;
      noneCount: number;
    };
  };
  months: {
    key: string;
    label: string;
    recordedCount: number;
    forecastCount: number;
    paymentCount: number;
    recordedNet: string;
    forecastIncome: string;
    forecastExpense: string;
    forecastNet: string;
    simulatedExpense: string;
    balanceBeforeScenario: string | null;
    balanceAfterScenario: string | null;
    delta: string;
    thresholdBreachCount: number;
    globalNegative: boolean;
  }[];
  accounts: {
    id: string;
    name: string;
    currency: Currency;
    archived: boolean;
    recordedBalance: string | null;
    paymentsTotal: string;
    floor: string;
    floorSource: SimulationFloorSource;
    currentMonthEndBefore: string | null;
    currentMonthEndAfter: string | null;
    lowestAfter: string | null;
    lowestMonth: string | null;
    thresholdBreached: boolean | null;
    thresholdCausedByScenario: boolean;
    firstBreachMonth: string | null;
  }[];
  payments: {
    index: number;
    accountId: string | null;
    accountName: string;
    currency: Currency;
    amount: string;
    operationDate: string;
    balanceBefore: string | null;
    balanceAfter: string | null;
    globalBalanceAfter: string | null;
    accountCumulative: string;
    thresholdBreached: boolean | null;
    thresholdCausedByScenario: boolean;
    allocations: {
      accountId: string;
      accountName: string;
      amount: string;
      balanceBefore: string;
      balanceAfter: string;
      floor: string;
      floorSource: SimulationFloorSource;
      preservesFloor: boolean;
      thresholdBreached: boolean;
      thresholdCausedByScenario: boolean;
    }[];
    unallocatedAmount: string;
  }[];
  budget: {
    categoryId: string;
    categoryName: string;
    currency: Currency;
    hasBudget: boolean;
    rows: {
      key: string;
      label: string;
      planned: string | null;
      actualBefore: string;
      simulatedExpense: string;
      actualAfter: string;
      remainingBefore: string | null;
      remainingAfter: string | null;
      status: BudgetImpactStatus;
    }[];
  } | null;
  warnings: string[];
};

function decimal(value: { toFixed: (places: number) => string } | null): string | null {
  return value === null ? null : value.toFixed(2);
}

export function serializeSimulationResult(
  result: SimulationResult,
): SerializedSimulationResult {
  return {
    currency: result.currency,
    totalAmount: result.totalAmount.toFixed(2),
    horizon: result.horizon,
    summary: {
      verdict: result.summary.verdict,
      totalAmount: result.summary.totalAmount.toFixed(2),
      recordedBalance: decimal(result.summary.recordedBalance),
      currentMonthKey: result.summary.currentMonthKey,
      currentMonthEndBefore: decimal(result.summary.currentMonthEndBefore),
      currentMonthEndAfter: decimal(result.summary.currentMonthEndAfter),
      currentMonthDelta: result.summary.currentMonthDelta.toFixed(2),
      lowestProjected: decimal(result.summary.lowestProjected),
      lowestProjectedMonth: result.summary.lowestProjectedMonth,
      lowestAccount: result.summary.lowestAccount
        ? {
            ...result.summary.lowestAccount,
            amount: result.summary.lowestAccount.amount.toFixed(2),
          }
        : null,
      firstThresholdBreach: result.summary.firstThresholdBreach
        ? {
            ...result.summary.firstThresholdBreach,
            amount: result.summary.firstThresholdBreach.amount.toFixed(2),
            floor: result.summary.firstThresholdBreach.floor.toFixed(2),
          }
        : null,
      globalNegativeMonth: result.summary.globalNegativeMonth,
      thresholds: result.summary.thresholds,
    },
    months: result.months.map((month) => ({
      ...month,
      recordedNet: month.recordedNet.toFixed(2),
      forecastIncome: month.forecastIncome.toFixed(2),
      forecastExpense: month.forecastExpense.toFixed(2),
      forecastNet: month.forecastNet.toFixed(2),
      simulatedExpense: month.simulatedExpense.toFixed(2),
      balanceBeforeScenario: decimal(month.balanceBeforeScenario),
      balanceAfterScenario: decimal(month.balanceAfterScenario),
      delta: month.delta.toFixed(2),
    })),
    accounts: result.accounts.map((account) => ({
      ...account,
      recordedBalance: decimal(account.recordedBalance),
      paymentsTotal: account.paymentsTotal.toFixed(2),
      floor: account.floor.toFixed(2),
      currentMonthEndBefore: decimal(account.currentMonthEndBefore),
      currentMonthEndAfter: decimal(account.currentMonthEndAfter),
      lowestAfter: decimal(account.lowestAfter),
    })),
    payments: result.payments.map((payment) => ({
      ...payment,
      amount: payment.amount.toFixed(2),
      operationDate: payment.operationDate.toISOString().slice(0, 10),
      balanceBefore: decimal(payment.balanceBefore),
      balanceAfter: decimal(payment.balanceAfter),
      globalBalanceAfter: decimal(payment.globalBalanceAfter),
      accountCumulative: payment.accountCumulative.toFixed(2),
      unallocatedAmount: payment.unallocatedAmount.toFixed(2),
      allocations: payment.allocations.map((allocation) => ({
        ...allocation,
        amount: allocation.amount.toFixed(2),
        balanceBefore: allocation.balanceBefore.toFixed(2),
        balanceAfter: allocation.balanceAfter.toFixed(2),
        floor: allocation.floor.toFixed(2),
      })),
    })),
    budget: result.budget
      ? {
          ...result.budget,
          rows: result.budget.rows.map((row) => ({
            ...row,
            planned: decimal(row.planned),
            actualBefore: row.actualBefore.toFixed(2),
            simulatedExpense: row.simulatedExpense.toFixed(2),
            actualAfter: row.actualAfter.toFixed(2),
            remainingBefore: decimal(row.remainingBefore),
            remainingAfter: decimal(row.remainingAfter),
          })),
        }
      : null,
    warnings: result.warnings,
  };
}
