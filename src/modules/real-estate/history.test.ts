import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { buildPropertyHistory } from "./history";
import type { PropertyCashflowDetail } from "./domain";
import type { LoanSummary } from "./loans";

/** Fictitious data only. */
function cashflow(overrides: Partial<PropertyCashflowDetail> = {}): PropertyCashflowDetail {
  return {
    id: "cashflow-1",
    kind: "EXPENSE",
    label: "Charge de test",
    currency: "EUR",
    amount: new Decimal("-120.00"),
    dueDate: null,
    settledAt: null,
    transaction: null,
    notes: null,
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    ...overrides,
  };
}

function loan(overrides: Partial<LoanSummary> = {}): LoanSummary {
  return {
    id: "loan-1",
    propertyId: "property-1",
    label: "Crédit",
    currency: "EUR",
    initialPrincipal: new Decimal("200000.00"),
    outstandingBalance: new Decimal("150000.00"),
    balanceAsOf: new Date(Date.UTC(2026, 0, 1)),
    interestRate: null,
    termMonths: null,
    paymentAmount: null,
    insuranceAmount: null,
    startDate: new Date(Date.UTC(2021, 5, 1)),
    endDate: null,
    notes: null,
    ...overrides,
  };
}

const base = {
  currency: "EUR" as const,
  purchaseDate: null,
  purchasePrice: null,
  estimatedValue: null,
  estimatedValueAsOf: null,
  saleDate: null,
  salePrice: null,
  cashflows: [],
  loans: [],
};

describe("buildPropertyHistory", () => {
  it("orders events from the most recent to the oldest", () => {
    const history = buildPropertyHistory({
      ...base,
      purchaseDate: new Date(Date.UTC(2020, 0, 10)),
      purchasePrice: new Decimal("180000.00"),
      estimatedValue: new Decimal("230000.00"),
      estimatedValueAsOf: new Date(Date.UTC(2026, 9, 1)),
      cashflows: [
        cashflow({ dueDate: new Date(Date.UTC(2026, 5, 15)) }),
        cashflow({ id: "cashflow-2", dueDate: new Date(Date.UTC(2025, 5, 15)) }),
      ],
    });

    expect(history.map((event) => event.kind)).toEqual([
      "VALUATION",
      "CASHFLOW",
      "CASHFLOW",
      "PURCHASE",
    ]);
  });

  it("dates a settled cashflow by its settlement, not by its due date", () => {
    const history = buildPropertyHistory({
      ...base,
      cashflows: [
        cashflow({
          dueDate: new Date(Date.UTC(2026, 5, 15)),
          settledAt: new Date(Date.UTC(2026, 5, 20)),
        }),
      ],
    });

    expect(history[0].date.toISOString()).toBe("2026-06-20T00:00:00.000Z");
  });

  it("shows a linked transaction amount, exactly like the totals", () => {
    const history = buildPropertyHistory({
      ...base,
      cashflows: [
        cashflow({
          amount: new Decimal("-999.00"),
          transaction: {
            id: "tx-1",
            label: "Travaux",
            amount: new Decimal("-500.00"),
          },
        }),
      ],
    });

    expect(history[0].amount?.toFixed(2)).toBe("500.00");
    expect(history[0].direction).toBe("OUTFLOW");
    expect(history[0].detail).toMatch(/Travaux/);
  });

  it("reports an income as an inflow with a positive magnitude", () => {
    const history = buildPropertyHistory({
      ...base,
      cashflows: [cashflow({ kind: "INCOME", amount: new Decimal("900.00") })],
    });

    expect(history[0].amount?.toFixed(2)).toBe("900.00");
    expect(history[0].direction).toBe("INFLOW");
  });

  it("records the purchase, the valuation, the loan and the sale", () => {
    const history = buildPropertyHistory({
      ...base,
      purchaseDate: new Date(Date.UTC(2020, 0, 10)),
      purchasePrice: new Decimal("180000.00"),
      estimatedValue: new Decimal("230000.00"),
      estimatedValueAsOf: new Date(Date.UTC(2026, 9, 1)),
      saleDate: new Date(Date.UTC(2026, 9, 20)),
      salePrice: new Decimal("300000.00"),
      loans: [loan()],
    });

    const kinds = history.map((event) => event.kind);
    expect(kinds).toContain("PURCHASE");
    expect(kinds).toContain("VALUATION");
    expect(kinds).toContain("LOAN");
    expect(kinds).toContain("SALE");
    expect(history[0].kind).toBe("SALE");
  });

  it("keeps an entry with neither an amount nor a transaction instead of failing", () => {
    const history = buildPropertyHistory({
      ...base,
      cashflows: [cashflow({ amount: null, transaction: null })],
    });

    expect(history).toHaveLength(1);
    expect(history[0].amount).toBeNull();
  });

  it("reports a missing purchase price without inventing a zero", () => {
    const history = buildPropertyHistory({
      ...base,
      purchaseDate: new Date(Date.UTC(2020, 0, 10)),
      purchasePrice: null,
    });

    expect(history[0].amount).toBeNull();
    expect(history[0].detail).toMatch(/non renseigné/);
  });
});
