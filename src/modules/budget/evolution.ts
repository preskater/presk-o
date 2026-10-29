import Decimal from "decimal.js";
import type { Currency } from "@/lib/money";
import { summariseForecastMonth, type ForecastContribution } from "./recurrence";

/**
 * Day-by-day balance of one month, for the Prévisions chart.
 *
 * Definitions, documented because the chart must agree with the tables:
 *
 * - `recorded` is the signed cumulative of the **recorded operations** only, starting
 *   from `opening` — the currency's recorded balance strictly before the first day.
 *   Day 1 therefore already includes everything recorded before the month.
 * - `echeances` is the signed cumulative of the **still-undecided** movements of the
 *   month alone (the pending échéances and the simulated salary), starting from zero: it
 *   reads as their weight so far, not as a balance. A confirmed occurrence became a
 *   recorded operation, so it is never counted twice.
 * - `projected` is the simulated balance: `recorded + echeances + carryOver`, i.e. where
 *   the month would end up if every pending movement went through. `carryOver` is what the
 *   simulation had **already counted and the ledger has not**: the previous month's
 *   undecided échéances and its simulated (unbooked) salary. Without it the simulated line
 *   would restart from the recorded balance every month and silently drop the month
 *   before — the schedule's simulation would say one thing and the chart another.
 * - `dayNet` is what moved on that very day, recorded plus pending, so a reader can tell
 *   a dip from a climb without subtracting two cumulative figures.
 *
 * One point per calendar day, including days without any movement: a flat day is a real
 * day of the month, not a missing one. `opening` is the caller's decision (a currency
 * with recorded operations in the month but none before starts at zero, like the
 * simulated balance of the six-month schedule); a currency nothing was ever recorded in
 * has no balance at all and must not be drawn.
 */
export type DailyBalancePoint = {
  /** Calendar day of the month, 1-based. */
  day: number;
  /** The same day at UTC midnight, like every date-only value. */
  date: Date;
  recorded: Decimal;
  /** Signed cumulative of the **pending** movements alone, from zero: their weight so far. */
  echeances: Decimal;
  /** Recorded + pending: the simulated balance. */
  projected: Decimal;
  /** Recorded + pending movements dated exactly on this day. */
  dayNet: Decimal;
};

export type MonthMovement = {
  /** Calendar day at UTC midnight. */
  date: Date;
  /** Signed: positive is money in, negative is money out. */
  amount: Decimal;
};

/** Days in a month, `month` being 1-based. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function buildDailyBalance(input: {
  year: number;
  /** 1-based month, like `monthRange`. */
  month: number;
  /** Recorded cumulative strictly before the month; zero when nothing was recorded. */
  opening: Decimal;
  /** Simulated net carried from the previous month (see the type's documentation). */
  carryOver?: Decimal;
  recorded: readonly MonthMovement[];
  pending: readonly MonthMovement[];
}): DailyBalancePoint[] {
  const dayCount = daysInMonth(input.year, input.month);
  const recordedByDay = new Map<number, Decimal>();
  const pendingByDay = new Map<number, Decimal>();

  const bucket = (movements: readonly MonthMovement[], target: Map<number, Decimal>) => {
    for (const movement of movements) {
      const day = movement.date.getUTCDate();

      // A movement outside the month would silently land on a day of another month:
      // refuse it rather than draw a line that cannot be trusted.
      if (
        movement.date.getUTCFullYear() !== input.year ||
        movement.date.getUTCMonth() !== input.month - 1
      ) {
        throw new Error(
          `Movement dated ${movement.date.toISOString().slice(0, 10)} is outside ${input.year}-${String(
            input.month,
          ).padStart(2, "0")}.`,
        );
      }

      target.set(day, (target.get(day) ?? new Decimal(0)).plus(movement.amount));
    }
  };

  bucket(input.recorded, recordedByDay);
  bucket(input.pending, pendingByDay);

  const carryOver = input.carryOver ?? new Decimal(0);
  const points: DailyBalancePoint[] = [];
  let recorded = input.opening;
  let echeances = new Decimal(0);

  for (let day = 1; day <= dayCount; day += 1) {
    const recordedToday = recordedByDay.get(day) ?? new Decimal(0);
    const pendingToday = pendingByDay.get(day) ?? new Decimal(0);

    recorded = recorded.plus(recordedToday);
    echeances = echeances.plus(pendingToday);

    points.push({
      day,
      date: new Date(Date.UTC(input.year, input.month - 1, day)),
      recorded,
      echeances,
      projected: recorded.plus(echeances).plus(carryOver),
      dayNet: recordedToday.plus(pendingToday),
    });
  }

  return points;
}

/**
 * The simulated net carried into a month from the one before, per currency.
 *
 * Only the **pending** contributions are carried: a confirmed one became a recorded
 * operation (and is already inside the opening balance), and a skipped or dismissed one
 * was explicitly dropped. Carrying a confirmed movement would count it twice; ignoring a
 * pending one would make the simulated line restart from the recorded balance every month,
 * contradicting the six-month schedule.
 */
export function carryOverNet(
  contributions: readonly ForecastContribution[],
): Map<Currency, Decimal> {
  return new Map(
    summariseForecastMonth(
      contributions.filter((contribution) => contribution.status === "PENDING"),
    ).map((totals) => [totals.currency, totals.net]),
  );
}
