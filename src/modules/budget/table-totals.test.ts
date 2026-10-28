import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { Currency } from "@/lib/money";
import { sumPerCurrency } from "./table-totals";

type Row = { currency: Currency; amount: string | null };

function row(currency: Currency, amount: string | null): Row {
  return { currency, amount };
}

const pick = (entry: Row) => ({
  currency: entry.currency,
  amount: entry.amount === null ? null : new Decimal(entry.amount),
});

describe("sumPerCurrency", () => {
  it("returns no row at all for an empty list, rather than a zero", () => {
    expect(sumPerCurrency([], pick).size).toBe(0);
  });

  it("sums exactly inside one currency and keeps currencies apart", () => {
    const totals = sumPerCurrency(
      [row("EUR", "1200.10"), row("EUR", "-200.05"), row("USD", "99.99")],
      pick,
    );

    expect(totals.get("EUR")?.amount.toFixed(2)).toBe("1000.05");
    expect(totals.get("EUR")?.complete).toBe(true);
    expect(totals.get("USD")?.amount.toFixed(2)).toBe("99.99");
    expect(totals.size).toBe(2);
  });

  it("marks a currency incomplete when a row is unknown, without dropping the known sum", () => {
    const totals = sumPerCurrency([row("EUR", "300.00"), row("EUR", null)], pick);

    expect(totals.get("EUR")?.amount.toFixed(2)).toBe("300.00");
    expect(totals.get("EUR")?.complete).toBe(false);
  });

  it("cancels the two legs of an internal transfer in the signed total", () => {
    const totals = sumPerCurrency(
      [row("EUR", "-250.00"), row("EUR", "250.00"), row("EUR", "-40.00")],
      pick,
    );

    expect(totals.get("EUR")?.amount.toFixed(2)).toBe("-40.00");
  });
});
