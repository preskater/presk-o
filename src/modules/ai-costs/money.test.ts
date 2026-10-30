import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { costMoney, InvalidCostMoneyError, roundToCents } from "./money";

describe("roundToCents", () => {
  it("rounds half-up, away from zero", () => {
    expect(roundToCents("1.005").toFixed(2)).toBe("1.01");
    expect(roundToCents("-1.005").toFixed(2)).toBe("-1.01");
    expect(roundToCents("2.675").toFixed(2)).toBe("2.68");
    expect(roundToCents("-2.675").toFixed(2)).toBe("-2.68");
  });

  it("rounds values below the half cent down", () => {
    expect(roundToCents("1.0049").toFixed(2)).toBe("1.00");
    expect(roundToCents("1.004").toFixed(2)).toBe("1.00");
  });

  it("keeps exact decimal arithmetic", () => {
    expect(
      roundToCents("0.1").plus(roundToCents("0.2")).toFixed(2),
    ).toBe("0.30");
  });

  it("works on an existing Decimal", () => {
    expect(roundToCents(new Decimal("12.344")).toFixed(2)).toBe("12.34");
  });

  it("refuses a missing, non-finite or non-decimal amount", () => {
    expect(() => roundToCents(undefined as unknown as Decimal.Value)).toThrow(
      InvalidCostMoneyError,
    );
    expect(() => roundToCents(Number.POSITIVE_INFINITY)).toThrow(
      InvalidCostMoneyError,
    );
    expect(() => roundToCents(Number.NaN)).toThrow(InvalidCostMoneyError);
    expect(() => roundToCents("0x10")).toThrow(InvalidCostMoneyError);
    expect(() => roundToCents("12,50")).toThrow(InvalidCostMoneyError);
  });
});

describe("costMoney", () => {
  it("rounds to cents and preserves the original currency", () => {
    const value = costMoney("10.005", "USD");

    expect(value.amount.toFixed(2)).toBe("10.01");
    expect(value.currency).toBe("USD");
  });

  it("returns a frozen value", () => {
    const value = costMoney("1", "EUR");

    expect(Object.isFrozen(value)).toBe(true);
    expect(() => Object.assign(value, { currency: "USD" })).toThrow(TypeError);
  });

  it("refuses an unsupported currency", () => {
    expect(() => costMoney("1", "JPY")).toThrow(InvalidCostMoneyError);
  });

  it("keeps a zero amount as a known zero", () => {
    const value = costMoney("0", "EUR");

    expect(value.amount.toFixed(2)).toBe("0.00");
  });
});
