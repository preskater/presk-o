import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  computeLoanTotals,
  loanInputSchema,
  loanUpdateSchema,
  type LoanSummary,
} from "./loans";

/** Fictitious amounts only. */
function loan(overrides: Partial<LoanSummary> = {}): LoanSummary {
  return {
    id: overrides.id ?? "loan-1",
    propertyId: overrides.propertyId ?? "property-1",
    label: overrides.label ?? "Crédit de test",
    currency: overrides.currency ?? "EUR",
    initialPrincipal: overrides.initialPrincipal ?? new Decimal("250000.00"),
    outstandingBalance:
      overrides.outstandingBalance === undefined
        ? new Decimal("198500.00")
        : overrides.outstandingBalance,
    balanceAsOf: overrides.balanceAsOf ?? null,
    interestRate:
      overrides.interestRate === undefined ? new Decimal("3.45") : overrides.interestRate,
    termMonths: overrides.termMonths === undefined ? 240 : overrides.termMonths,
    paymentAmount:
      overrides.paymentAmount === undefined ? new Decimal("1250.00") : overrides.paymentAmount,
    insuranceAmount:
      overrides.insuranceAmount === undefined ? new Decimal("45.00") : overrides.insuranceAmount,
    startDate: overrides.startDate ?? null,
    endDate: overrides.endDate ?? null,
    notes: overrides.notes ?? null,
  };
}

describe("computeLoanTotals", () => {
  it("sums the monthly cost (payment + insurance) and the outstanding debt", () => {
    const totals = computeLoanTotals([loan()], { currency: "EUR" });

    expect(totals.monthlyCost?.toFixed(2)).toBe("1295.00");
    expect(totals.outstandingDebt?.toFixed(2)).toBe("198500.00");
    expect(totals.unknownBalances).toBe(0);
  });

  it("reads a missing balance as unknown, never as zero", () => {
    const totals = computeLoanTotals([loan({ outstandingBalance: null })], { currency: "EUR" });

    expect(totals.outstandingDebt).toBeNull();
    expect(totals.unknownBalances).toBe(1);
  });

  it("leaves the monthly cost unknown when nothing is recorded", () => {
    const totals = computeLoanTotals(
      [loan({ paymentAmount: null, insuranceAmount: null })],
      { currency: "EUR" },
    );

    expect(totals.monthlyCost).toBeNull();
  });

  it("adds up two loans on the same property", () => {
    const totals = computeLoanTotals(
      [
        loan({ id: "loan-1" }),
        loan({
          id: "loan-2",
          outstandingBalance: new Decimal("50000.00"),
          paymentAmount: new Decimal("300.00"),
          insuranceAmount: new Decimal("10.00"),
        }),
      ],
      { currency: "EUR" },
    );

    expect(totals.monthlyCost?.toFixed(2)).toBe("1605.00");
    expect(totals.outstandingDebt?.toFixed(2)).toBe("248500.00");
    expect(totals.unknownBalances).toBe(0);
  });

  it("counts a loan with a payment but no balance without inventing a debt", () => {
    const totals = computeLoanTotals(
      [loan({ outstandingBalance: null }), loan({ id: "loan-2" })],
      { currency: "EUR" },
    );

    expect(totals.outstandingDebt?.toFixed(2)).toBe("198500.00");
    expect(totals.unknownBalances).toBe(1);
  });

  it("refuses to mix currencies in one total", () => {
    expect(() =>
      computeLoanTotals([loan(), loan({ id: "loan-2", currency: "USD" })], { currency: "EUR" }),
    ).toThrow(/currency/);
  });

  it("keeps one total per currency when grouped", () => {
    const euros = computeLoanTotals([loan()], { currency: "EUR" });
    const dollars = computeLoanTotals(
      [loan({ id: "usd", currency: "USD", outstandingBalance: new Decimal("1000.00") })],
      { currency: "USD" },
    );

    expect(euros.currency).toBe("EUR");
    expect(dollars.currency).toBe("USD");
    expect(dollars.outstandingDebt?.toFixed(2)).toBe("1000.00");
  });
});

describe("loanInputSchema", () => {
  const valid = {
    propertyId: "property-1",
    label: "Crédit immobilier",
    currency: "EUR",
    initialPrincipal: "250 000,00",
    outstandingBalance: "198 500,00",
    balanceAsOf: "2026-01-01",
    interestRate: "3,45",
    termMonths: "240",
    paymentAmount: "1 250,00",
    insuranceAmount: "45,00",
    startDate: "2021-06-01",
    endDate: "2041-06-01",
    notes: "",
  };

  it("parses a full loan into exact decimals and calendar days", () => {
    const parsed = loanInputSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.initialPrincipal.toFixed(2)).toBe("250000.00");
    expect(parsed.data.interestRate?.toFixed(2)).toBe("3.45");
    expect(parsed.data.termMonths).toBe(240);
    expect(parsed.data.balanceAsOf?.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(parsed.data.notes).toBeNull();
  });

  it("refuses a non-positive principal", () => {
    expect(loanInputSchema.safeParse({ ...valid, initialPrincipal: "0" }).success).toBe(false);
    expect(loanInputSchema.safeParse({ ...valid, initialPrincipal: "-10" }).success).toBe(false);
  });

  it("refuses a balance without its observation date", () => {
    const parsed = loanInputSchema.safeParse({ ...valid, balanceAsOf: "" });
    expect(parsed.success).toBe(false);
  });

  it("refuses a balance date without a balance", () => {
    const parsed = loanInputSchema.safeParse({ ...valid, outstandingBalance: "" });
    expect(parsed.success).toBe(false);
  });

  it("refuses an end date before the start date", () => {
    const parsed = loanInputSchema.safeParse({ ...valid, endDate: "2020-01-01" });
    expect(parsed.success).toBe(false);
  });

  it("treats empty optional fields as unknown", () => {
    const parsed = loanInputSchema.safeParse({
      ...valid,
      outstandingBalance: "",
      balanceAsOf: "",
      interestRate: "",
      termMonths: "",
      paymentAmount: "",
      insuranceAmount: "",
      startDate: "",
      endDate: "",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.outstandingBalance).toBeNull();
    expect(parsed.data.interestRate).toBeNull();
    expect(parsed.data.termMonths).toBeNull();
    expect(parsed.data.paymentAmount).toBeNull();
  });

  it("requires an identifier when updating", () => {
    expect(loanUpdateSchema.safeParse(valid).success).toBe(false);
    expect(loanUpdateSchema.safeParse({ ...valid, id: "loan-1" }).success).toBe(true);
  });
});
