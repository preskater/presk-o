import Decimal from "decimal.js";
import type { SimulationFloorSource } from "./simulation";

/**
 * The safety floor used for one account in the expense simulation.
 *
 * The rule is deliberately simple and written down once:
 *
 * - A per-account threshold set by the owner always wins, including an explicit zero.
 * - Otherwise, a positive global `LOW_BALANCE` threshold is used when it is at least
 *   the suggestion.
 * - Otherwise, the suggestion is used.
 * - With no configured floor and no expenses to learn from, the floor is zero: a
 *   negative balance is still visible, but no cushion is invented.
 *
 * The suggestion is one month of the account's usual expenses: the average over the
 * last three complete months, or the current month's still-pending expenses when they
 * are higher. Three months smooth a one-off purchase; a month is the cushion itself.
 */
export const THRESHOLD_AVERAGE_MONTHS = 3;

export function suggestAccountFloor(input: {
  expensesLastThreeMonths: Decimal;
  pendingExpenses: Decimal;
}): Decimal {
  const average = input.expensesLastThreeMonths
    .dividedBy(THRESHOLD_AVERAGE_MONTHS)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return average.greaterThan(input.pendingExpenses) ? average : input.pendingExpenses;
}

export function resolveAccountFloor(input: {
  configured: Decimal | null;
  global: Decimal | null;
  suggested: Decimal;
}): { floor: Decimal; source: SimulationFloorSource } {
  if (input.configured !== null) {
    return { floor: input.configured, source: "ACCOUNT" };
  }

  if (
    input.global !== null &&
    input.global.greaterThanOrEqualTo(input.suggested)
  ) {
    return { floor: input.global, source: "GLOBAL" };
  }

  if (input.suggested.greaterThan(0)) {
    return { floor: input.suggested, source: "SUGGESTED" };
  }

  return { floor: new Decimal(0), source: "NONE" };
}
