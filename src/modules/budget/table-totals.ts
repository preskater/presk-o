import Decimal from "decimal.js";
import type { Currency } from "@/lib/money";

/**
 * Footer totals of the budget tables, grouped by currency.
 *
 * Rules, documented because a total nobody can verify is not usable:
 *
 * - A total is only ever added inside one currency. The dashboard never converts, so an
 *   EUR + USD figure would be meaningless; a multi-currency list gets one footer row per
 *   currency.
 * - A contribution may be unknown (`null`): an account with no recorded operation, a goal
 *   without a source, a category without a recent average. The known rows are still added,
 *   but `complete` turns false so the caller shows "—" rather than a figure that would
 *   quietly pass an unknown off as a zero.
 * - No row means no total: an empty list yields an empty map, never a zero row.
 */
export type CurrencyTotal = {
  currency: Currency;
  amount: Decimal;
  /** False when at least one row contributed an unknown amount. */
  complete: boolean;
};

export function sumPerCurrency<T>(
  rows: readonly T[],
  pick: (row: T) => { currency: Currency; amount: Decimal | null },
): Map<Currency, CurrencyTotal> {
  const totals = new Map<Currency, CurrencyTotal>();

  for (const row of rows) {
    const { currency, amount } = pick(row);
    const total = totals.get(currency) ?? {
      currency,
      amount: new Decimal(0),
      complete: true,
    };

    if (amount === null) {
      total.complete = false;
    } else {
      total.amount = total.amount.plus(amount);
    }

    totals.set(currency, total);
  }

  return totals;
}
