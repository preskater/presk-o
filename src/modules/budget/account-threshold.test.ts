import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  resolveAccountFloor,
  suggestAccountFloor,
  THRESHOLD_AVERAGE_MONTHS,
} from "./account-threshold";

function d(value: string): Decimal {
  return new Decimal(value);
}

describe("suggestAccountFloor", () => {
  it("uses one month of the average expenses over the configured window", () => {
    const suggested = suggestAccountFloor({
      expensesLastThreeMonths: d("3000"),
      pendingExpenses: d("400"),
    });

    expect(THRESHOLD_AVERAGE_MONTHS).toBe(3);
    expect(suggested.toFixed(2)).toBe("1000.00");
  });

  it("keeps the current month's pending expenses when they are higher", () => {
    const suggested = suggestAccountFloor({
      expensesLastThreeMonths: d("300"),
      pendingExpenses: d("450"),
    });

    expect(suggested.toFixed(2)).toBe("450.00");
  });
});

describe("resolveAccountFloor", () => {
  it("lets an explicit account threshold win, including zero", () => {
    expect(
      resolveAccountFloor({
        configured: d("0"),
        global: d("500"),
        suggested: d("800"),
      }),
    ).toEqual({ floor: d("0"), source: "ACCOUNT" });
  });

  it("uses the global rule when it is at least the suggestion", () => {
    expect(
      resolveAccountFloor({
        configured: null,
        global: d("700"),
        suggested: d("500"),
      }),
    ).toEqual({ floor: d("700"), source: "GLOBAL" });
  });

  it("uses the suggestion when it is higher than the global rule", () => {
    expect(
      resolveAccountFloor({
        configured: null,
        global: d("200"),
        suggested: d("500"),
      }),
    ).toEqual({ floor: d("500"), source: "SUGGESTED" });
  });

  it("reports no floor when nothing is configured and nothing is suggested", () => {
    expect(
      resolveAccountFloor({
        configured: null,
        global: null,
        suggested: d("0"),
      }),
    ).toEqual({ floor: d("0"), source: "NONE" });
  });
});
