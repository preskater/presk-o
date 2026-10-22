import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { monthRange, parseMonthKey, shiftMonthKey } from "@/lib/dates";
import { InvalidAmountError, money, parseAmountInput, sumMoney, toDecimalString } from "@/lib/money";
import { randomInt, seededRandom } from "./helpers";

/**
 * Invariant 2 — exact money, and the month windows totals are computed over.
 *
 * Amounts are generated as integer cents, the only exact reference a test can trust;
 * every property compares the application's arithmetic with that reference.
 */

const CASES = 300;

/** Cents → "-1234.56", built with integers only. */
function centsToString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function randomCents(random: () => number): number {
  return randomInt(random, -5_000_000, 5_000_000);
}

describe("invariant: exact money", () => {
  it("sums to the cent, whatever the values and their order", () => {
    const random = seededRandom(20261022);

    for (let run = 0; run < CASES; run += 1) {
      const cents = Array.from({ length: randomInt(random, 0, 40) }, () => randomCents(random));
      const expected = centsToString(cents.reduce((total, value) => total + value, 0));
      const values = cents.map((value) => money(centsToString(value)));

      expect(toDecimalString(sumMoney(values).amount), `seed run ${run}`).toBe(expected);
      expect(toDecimalString(sumMoney([...values].reverse()).amount)).toBe(expected);
    }
  });

  it("parses what it formats, in the French notations people type", () => {
    const random = seededRandom(7);

    for (let run = 0; run < CASES; run += 1) {
      const text = centsToString(randomCents(random));
      const comma = text.replace(".", ",");
      const [whole, fraction] = comma.replace("-", "").split(",");
      const grouped = `${text.startsWith("-") ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${fraction}`;

      for (const typed of [text, comma, grouped, `${comma} €`]) {
        expect(toDecimalString(parseAmountInput(typed)), typed).toBe(text);
      }
    }
  });

  it("refuses a third decimal instead of rounding it away", () => {
    const random = seededRandom(11);

    for (let run = 0; run < 50; run += 1) {
      const typed = `${randomInt(random, 0, 9999)},${String(randomInt(random, 0, 999)).padStart(3, "0")}`;
      expect(() => parseAmountInput(typed), typed).toThrow(InvalidAmountError);
    }
  });

  it("never adds two currencies into one total", () => {
    expect(() => sumMoney([money("1.00", "EUR"), money("1.00", "USD")])).toThrow(/Cannot sum/);
  });

  it("negative control: the same sums in floating point are wrong", () => {
    // What the invariant protects against: 0.1 + 0.2 in binary floating point.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney([money("0.1"), money("0.2")]).amount.equals(new Decimal("0.3"))).toBe(true);
  });
});

describe("invariant: month windows tile the calendar", () => {
  it("each month ends exactly where the next one starts, with no gap or overlap", () => {
    const random = seededRandom(3);

    for (let run = 0; run < CASES; run += 1) {
      const key = `${randomInt(random, 1970, 2200)}-${String(randomInt(random, 1, 12)).padStart(2, "0")}`;
      const current = parseMonthKey(key);
      const next = parseMonthKey(shiftMonthKey(key, 1));
      const range = monthRange(current.year, current.month);

      expect(range.start.getTime()).toBeLessThan(range.end.getTime());
      expect(range.end.getTime(), key).toBe(monthRange(next.year, next.month).start.getTime());
      // A day belongs to exactly one month: the 1st of the next month is outside.
      expect(range.end.getUTCDate()).toBe(1);
      expect(shiftMonthKey(shiftMonthKey(key, 1), -1)).toBe(key);
    }
  });

  it("negative control: an inclusive end would count the 1st of the next month twice", () => {
    const march = monthRange(2026, 3);
    const april = monthRange(2026, 4);
    const firstOfApril = april.start;
    const inMarchIfInclusive = firstOfApril >= march.start && firstOfApril <= march.end;
    const inMarch = firstOfApril >= march.start && firstOfApril < march.end;

    expect(inMarchIfInclusive).toBe(true);
    expect(inMarch).toBe(false);
  });
});
