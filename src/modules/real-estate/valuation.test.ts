import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  computeEquity,
  computeSaleAnalysis,
  computeSaleProceeds,
  latestPropertyValuation,
  sumOutstandingDebt,
  type SaleAnalysisInput,
} from "./valuation";
import type { PropertyValuation } from "./domain";

/** Fictitious amounts only. */
function input(overrides: Partial<SaleAnalysisInput> = {}): SaleAnalysisInput {
  return {
    currency: "EUR",
    purchasePrice: new Decimal("200000.00"),
    estimatedValue: null,
    estimatedValueAsOf: null,
    targetGainRate: new Decimal("10"),
    saleDate: null,
    salePrice: null,
    saleCosts: null,
    totals: {
      income: new Decimal("12000.00"),
      expenses: new Decimal("15000.00"),
      currency: "EUR",
    },
    loans: [],
    ...overrides,
  };
}

describe("sumOutstandingDebt", () => {
  it("is a known zero without any loan", () => {
    const result = sumOutstandingDebt([], "EUR");

    expect(result.debt?.toFixed(2)).toBe("0.00");
    expect(result.unknownBalances).toBe(0);
  });

  describe("property valuation history and equity", () => {
    const valuation = (overrides: Partial<PropertyValuation> = {}): PropertyValuation => ({
      id: "valuation-1",
      valuedOn: new Date(Date.UTC(2026, 0, 1)),
      amount: new Decimal("250000"),
      currency: "EUR",
      sourceNote: null,
      createdAt: new Date(Date.UTC(2026, 0, 2)),
      ...overrides,
    });

    it("keeps equity unknown without a valuation", () => {
      expect(computeEquity(null, new Decimal("100"), "EUR")).toBeNull();
    });

    it("uses the latest dated valuation", () => {
      const latest = latestPropertyValuation([
        valuation(),
        valuation({
          id: "valuation-2",
          valuedOn: new Date(Date.UTC(2026, 5, 1)),
          amount: new Decimal("275000"),
        }),
      ]);

      expect(latest?.amount.toFixed(2)).toBe("275000.00");
      expect(computeEquity(latest, new Decimal("150000"), "EUR")?.toFixed(2)).toBe(
        "125000.00",
      );
    });

    it("does not mix valuation and debt currencies", () => {
      expect(
        computeEquity(valuation({ currency: "USD" }), new Decimal("100"), "EUR"),
      ).toBeNull();
    });
  });

  it("adds the recorded balances of the property's currency", () => {
    const result = sumOutstandingDebt(
      [
        { currency: "EUR", outstandingBalance: new Decimal("150000.00") },
        { currency: "EUR", outstandingBalance: new Decimal("25000.00") },
      ],
      "EUR",
    );

    expect(result.debt?.toFixed(2)).toBe("175000.00");
  });

  it("keeps the debt unknown when one balance was never recorded", () => {
    const result = sumOutstandingDebt(
      [
        { currency: "EUR", outstandingBalance: new Decimal("150000.00") },
        { currency: "EUR", outstandingBalance: null },
      ],
      "EUR",
    );

    expect(result.debt).toBeNull();
    expect(result.unknownBalances).toBe(1);
  });

  it("never converts a loan in another currency", () => {
    const result = sumOutstandingDebt(
      [{ currency: "CHF", outstandingBalance: new Decimal("100000.00") }],
      "EUR",
    );

    expect(result.debt).toBeNull();
    expect(result.foreignCurrencyLoans).toBe(1);
  });
});

describe("computeSaleAnalysis", () => {
  it("computes the net invested capital from the acquisition price and the cashflow", () => {
    const analysis = computeSaleAnalysis(input());

    expect(analysis.netInvested?.toFixed(2)).toBe("203000.00");
    expect(analysis.outstandingDebt?.toFixed(2)).toBe("0.00");
    expect(analysis.breakEvenPrice?.toFixed(2)).toBe("203000.00");
    // 10 % of the net invested capital on top of the break-even price.
    expect(analysis.targetPrice?.toFixed(2)).toBe("223300.00");
    expect(analysis.status).toBe("NO_ESTIMATE");
  });

  it("subtracts the recorded debt and tells whether the target is reached", () => {
    const analysis = computeSaleAnalysis(
      input({
        estimatedValue: new Decimal("240000.00"),
        estimatedValueAsOf: new Date(Date.UTC(2026, 9, 1)),
        loans: [{ currency: "EUR", outstandingBalance: new Decimal("50000.00") }],
      }),
    );

    expect(analysis.outstandingDebt?.toFixed(2)).toBe("50000.00");
    expect(analysis.breakEvenPrice?.toFixed(2)).toBe("253000.00");
    expect(analysis.targetPrice?.toFixed(2)).toBe("273300.00");
    expect(analysis.estimatedEquity?.toFixed(2)).toBe("190000.00");
    expect(analysis.estimatedGain?.toFixed(2)).toBe("-13000.00");
    expect(analysis.gapToTarget?.toFixed(2)).toBe("33300.00");
    expect(analysis.status).toBe("BELOW_TARGET");
  });

  it("reports the target reached at or above the target price", () => {
    const analysis = computeSaleAnalysis(
      input({ estimatedValue: new Decimal("223300.00") }),
    );

    expect(analysis.gapToTarget?.toFixed(2)).toBe("0.00");
    expect(analysis.status).toBe("TARGET_REACHED");
  });

  it("keeps the projection unknown when an acquisition price is missing", () => {
    const analysis = computeSaleAnalysis(
      input({ purchasePrice: null, estimatedValue: new Decimal("250000.00") }),
    );

    expect(analysis.netInvested).toBeNull();
    expect(analysis.breakEvenPrice).toBeNull();
    expect(analysis.targetPrice).toBeNull();
    expect(analysis.estimatedGain).toBeNull();
    expect(analysis.status).toBe("UNKNOWN");
  });

  it("keeps the projection unknown when a loan balance is missing", () => {
    const analysis = computeSaleAnalysis(
      input({
        estimatedValue: new Decimal("250000.00"),
        loans: [{ currency: "EUR", outstandingBalance: null }],
      }),
    );

    expect(analysis.outstandingDebt).toBeNull();
    expect(analysis.breakEvenPrice).toBeNull();
    expect(analysis.status).toBe("UNKNOWN");
    expect(analysis.unknownLoanBalances).toBe(1);
  });

  it("never mixes the cashflow currency with the price currency", () => {
    const analysis = computeSaleAnalysis(
      input({
        estimatedValue: new Decimal("250000.00"),
        totals: {
          income: new Decimal("12000.00"),
          expenses: new Decimal("15000.00"),
          currency: "USD",
        },
      }),
    );

    expect(analysis.currencyMismatch).toBe(true);
    expect(analysis.netInvested).toBeNull();
    expect(analysis.status).toBe("UNKNOWN");
  });

  it("treats partial totals as a mismatch rather than a complete currency", () => {
    // Some cashflows are in another currency and were excluded before the analysis:
    // the remaining EUR total must not be presented as the property's full result.
    const analysis = computeSaleAnalysis(
      input({ estimatedValue: new Decimal("250000.00"), totalsComplete: false }),
    );

    expect(analysis.currencyMismatch).toBe(true);
    expect(analysis.netInvested).toBeNull();
    expect(analysis.status).toBe("UNKNOWN");
  });

  it("does not invent a negative gain target when rents repaid the capital", () => {
    const analysis = computeSaleAnalysis(
      input({
        purchasePrice: new Decimal("10000.00"),
        totals: {
          income: new Decimal("30000.00"),
          expenses: new Decimal("1000.00"),
          currency: "EUR",
        },
        estimatedValue: new Decimal("5000.00"),
      }),
    );

    // Net invested capital is negative: the margin base is zero, so the target is
    // the break-even price instead of a lower price derived from a negative base.
    expect(analysis.netInvested?.toFixed(2)).toBe("-19000.00");
    expect(analysis.targetPrice?.toFixed(2)).toBe("-19000.00");
    expect(analysis.status).toBe("TARGET_REACHED");
  });

  it("computes the recorded sale proceeds and gain", () => {
    const analysis = computeSaleAnalysis(
      input({
        saleDate: new Date(Date.UTC(2026, 9, 20)),
        salePrice: new Decimal("300000.00"),
        saleCosts: new Decimal("15000.00"),
        loans: [{ currency: "EUR", outstandingBalance: new Decimal("50000.00") }],
      }),
    );

    expect(analysis.status).toBe("SOLD");
    expect(analysis.sale?.netProceeds?.toFixed(2)).toBe("235000.00");
    expect(analysis.sale?.gain?.toFixed(2)).toBe("32000.00");
  });

  it("keeps a sale gain unknown when its costs were never recorded", () => {
    const analysis = computeSaleAnalysis(
      input({
        saleDate: new Date(Date.UTC(2026, 9, 20)),
        salePrice: new Decimal("300000.00"),
        saleCosts: null,
      }),
    );

    expect(analysis.status).toBe("SOLD");
    expect(analysis.sale?.netProceeds).toBeNull();
    expect(analysis.sale?.gain).toBeNull();
  });
});

describe("computeSaleProceeds", () => {
  it("deducts the costs and the recorded debt", () => {
    const proceeds = computeSaleProceeds({
      salePrice: new Decimal("300000.00"),
      saleCosts: new Decimal("15000.00"),
      outstandingDebt: new Decimal("50000.00"),
    });

    expect(proceeds?.toFixed(2)).toBe("235000.00");
  });

  it("is unknown without a debt or without costs", () => {
    expect(
      computeSaleProceeds({
        salePrice: new Decimal("300000.00"),
        saleCosts: new Decimal("15000.00"),
        outstandingDebt: null,
      }),
    ).toBeNull();

    expect(
      computeSaleProceeds({
        salePrice: new Decimal("300000.00"),
        saleCosts: null,
        outstandingDebt: new Decimal("0"),
      }),
    ).toBeNull();
  });
});
