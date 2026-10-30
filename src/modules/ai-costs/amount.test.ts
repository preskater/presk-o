import { describe, expect, it } from "vitest";
import {
  createCostAmount,
  InvalidCostAmountError,
  isKnownCostAmount,
  sumCostAmounts,
  type CostAmount,
  type CostAmountInput,
} from "./amount";
import { InvalidActualityError } from "./actuality";
import { createCostSource, UnsafeSourceReferenceError } from "./source";

const NOW = new Date("2026-10-28T12:00:00.000Z");

function manualSource(capturedAt: Date = NOW) {
  return createCostSource({
    kind: "manual",
    enteredBy: "user-1",
    capturedAt,
  });
}

function amount(overrides: Partial<CostAmountInput> = {}): CostAmount {
  return createCostAmount({
    money: { amount: "10", currency: "EUR" },
    actuality: "observed",
    source: manualSource(),
    operationDate: "2026-10-28",
    ...overrides,
  });
}

describe("createCostAmount", () => {
  it("keeps the amount, actuality, source and operation date", () => {
    const value = amount();

    expect(value.money?.amount.toFixed(2)).toBe("10.00");
    expect(value.money?.currency).toBe("EUR");
    expect(value.actuality).toBe("observed");
    expect(value.source).toMatchObject({ kind: "manual", enteredBy: "user-1" });
    expect(value.operationDate).toBe("2026-10-28");
  });

  it("distinguishes the capture instant from the operation date", () => {
    const value = amount({
      source: manualSource(new Date("2026-10-29T01:00:00.000Z")),
      operationDate: "2026-10-28",
    });

    expect(value.source.capturedAt).toBe("2026-10-29T01:00:00.000Z");
    expect(value.operationDate).toBe("2026-10-28");
  });

  it("normalises a Date operation date to its UTC calendar day", () => {
    const value = amount({
      operationDate: new Date("2026-10-27T23:30:00.000Z"),
    });

    expect(value.operationDate).toBe("2026-10-27");
  });

  it("rejects an impossible calendar day", () => {
    expect(() => amount({ operationDate: "2026-02-31" })).toThrow(
      InvalidCostAmountError,
    );
  });

  it("keeps an unknown amount unknown instead of turning it into zero", () => {
    const value = amount({ money: null });

    expect(value.money).toBeNull();
    expect(isKnownCostAmount(value)).toBe(false);
  });

  it("rejects an omitted amount: null must be explicit", () => {
    expect(() =>
      createCostAmount({
        actuality: "observed",
        source: manualSource(),
        operationDate: "2026-10-28",
      } as CostAmountInput),
    ).toThrow(InvalidCostAmountError);
  });

  it("requires an actuality", () => {
    expect(() =>
      amount({ actuality: undefined as unknown as CostAmountInput["actuality"] }),
    ).toThrow(InvalidActualityError);
  });

  it("rejects an unknown actuality", () => {
    expect(() => amount({ actuality: "forecast" })).toThrow(InvalidActualityError);
  });

  it("rounds half-up to the cent", () => {
    const value = amount({ money: { amount: "1.005", currency: "EUR" } });

    expect(value.money?.amount.toFixed(2)).toBe("1.01");
  });

  it("keeps the original currency and accepts a credit", () => {
    const value = amount({ money: { amount: "-4.50", currency: "USD" } });

    expect(value.money?.amount.toFixed(2)).toBe("-4.50");
    expect(value.money?.currency).toBe("USD");
  });

  it("rebuilds the source, so a token-shaped identifier is refused", () => {
    expect(() =>
      amount({
        source: {
          kind: "provider",
          provider: "openai",
          externalId: "sk-live-1234567890abcdef",
          capturedAt: NOW.toISOString(),
        },
      }),
    ).toThrow(UnsafeSourceReferenceError);
  });

  it("is frozen, including its amount and source", () => {
    const value = amount();

    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.source)).toBe(true);
    expect(Object.isFrozen(value.money)).toBe(true);
    expect(() => Object.assign(value, { actuality: "estimated" })).toThrow(TypeError);
    expect(value.actuality).toBe("observed");
  });
});

describe("sumCostAmounts", () => {
  it("adds known amounts exactly", () => {
    const total = sumCostAmounts([
      amount({ money: { amount: "0.10", currency: "EUR" } }),
      amount({ money: { amount: "0.20", currency: "EUR" } }),
    ]);

    expect(total?.amount.toFixed(2)).toBe("0.30");
    expect(total?.currency).toBe("EUR");
  });

  it("returns null when an amount is unknown: no partial total", () => {
    const total = sumCostAmounts([
      amount({ money: { amount: "10", currency: "EUR" } }),
      amount({ money: null }),
    ]);

    expect(total).toBeNull();
  });

  it("returns null for an empty set: no data is not a zero cost", () => {
    expect(sumCostAmounts([])).toBeNull();
  });

  it("refuses to add two currencies", () => {
    expect(() =>
      sumCostAmounts([
        amount({ money: { amount: "10", currency: "EUR" } }),
        amount({ money: { amount: "10", currency: "USD" } }),
      ]),
    ).toThrow(/Cannot sum USD and EUR/);
  });

  it("refuses an explicit currency that does not match the amounts", () => {
    expect(() =>
      sumCostAmounts([amount({ money: { amount: "10", currency: "EUR" } })], "USD"),
    ).toThrow(/Cannot sum EUR and USD/);
  });
});
