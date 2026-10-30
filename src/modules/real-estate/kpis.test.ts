import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  availableKpiYears,
  calendarYearPeriod,
  computePropertyKpis,
  kpiPeriodLabel,
  resolveKpiPeriod,
  trailingTwelveMonthsPeriod,
  type PropertyKpiInput,
} from "./kpis";
import type { PropertyCashflowDetail } from "./domain";
import type { LoanSummary } from "./loans";

/** Fictitious data only: no real transaction reaches a fixture. */
const NOW = new Date(Date.UTC(2026, 9, 30)); // 30 October 2026

function cashflow(overrides: Partial<PropertyCashflowDetail> = {}): PropertyCashflowDetail {
  return {
    id: "cashflow-1",
    kind: "EXPENSE",
    label: "Charge de test",
    currency: "EUR",
    amount: new Decimal("-100.00"),
    dueDate: new Date(Date.UTC(2026, 3, 10)),
    settledAt: null,
    transaction: null,
    notes: null,
    createdAt: new Date(Date.UTC(2020, 0, 1)),
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
    interestRate: new Decimal("3.00"),
    termMonths: 240,
    paymentAmount: new Decimal("1000.00"),
    insuranceAmount: new Decimal("20.00"),
    startDate: new Date(Date.UTC(2021, 5, 1)),
    endDate: null,
    notes: null,
    ...overrides,
  };
}

function input(overrides: Partial<PropertyKpiInput> = {}): PropertyKpiInput {
  return {
    currency: "EUR",
    occupancy: "RENTED",
    purchasePrice: new Decimal("200000.00"),
    cashflows: [],
    loans: [],
    period: trailingTwelveMonthsPeriod(NOW),
    ...overrides,
  };
}

describe("KPI periods", () => {
  it("covers the twelve months ending with the current month", () => {
    const period = trailingTwelveMonthsPeriod(NOW);

    expect(period.start.toISOString()).toBe("2025-11-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(period.months).toBe(12);
    expect(period.complete).toBe(true);
  });

  it("marks the calendar year still running as incomplete", () => {
    expect(calendarYearPeriod(2025, NOW).complete).toBe(true);
    expect(calendarYearPeriod(2026, NOW).complete).toBe(false);
    expect(kpiPeriodLabel(calendarYearPeriod(2026, NOW))).toBe("Année 2026 (en cours)");
  });

  it("falls back to the rolling window on a malformed or future period", () => {
    for (const value of [null, "année", "2027", "1899", "2026-05"]) {
      const period = resolveKpiPeriod(value, NOW);
      expect(period.kind, `value ${String(value)}`).toBe("TRAILING_TWELVE_MONTHS");
    }

    expect(resolveKpiPeriod("2025", NOW).kind).toBe("CALENDAR_YEAR");
    expect(resolveKpiPeriod("2025", NOW).year).toBe(2025);
  });

  it("offers every year holding a dated fact, most recent first", () => {
    const years = availableKpiYears({
      purchaseDate: new Date(Date.UTC(2019, 4, 1)),
      cashflows: [cashflow({ dueDate: new Date(Date.UTC(2023, 6, 1)) })],
      loans: [loan({ startDate: new Date(Date.UTC(2021, 5, 1)) })],
      now: NOW,
    });

    expect(years).toEqual([2026, 2023, 2021, 2019]);
  });
});

describe("computePropertyKpis", () => {
  it("totals rents and charges of the window into the NOI", () => {
    const result = computePropertyKpis(
      input({
        cashflows: [
          cashflow({ id: "rent", kind: "INCOME", amount: new Decimal("800.00") }),
          cashflow({
            id: "rent-2",
            kind: "INCOME",
            amount: new Decimal("800.00"),
            dueDate: new Date(Date.UTC(2026, 6, 10)),
          }),
          cashflow({ id: "works", kind: "EXPENSE", amount: new Decimal("-600.00") }),
        ],
      }),
    );

    expect(result.rentalIncome.toFixed(2)).toBe("1600.00");
    expect(result.operatingExpenses.toFixed(2)).toBe("600.00");
    expect(result.noi.toFixed(2)).toBe("1000.00");
    expect(result.cashflowCount).toBe(3);
    expect(result.inCurrencyCashflows).toBe(3);
    expect(result.currencyMismatch).toBe(false);
  });

  it("reports a property without any cashflow as no data, never as a result", () => {
    const result = computePropertyKpis(input({ occupancy: "VACANT", purchasePrice: null }));

    expect(result.cashflowCount).toBe(0);
    expect(result.rentalIncome.toFixed(2)).toBe("0.00");
    expect(result.noi.toFixed(2)).toBe("0.00");
    expect(result.grossYield.value).toBeNull();
    expect(result.grossYield.reason).toBe("NO_DATA");
    expect(result.netYield.reason).toBe("NO_DATA");
    expect(result.monthsWithRent).toBe(0);
  });

  it("handles a single cashflow leg without inventing the other side", () => {
    const result = computePropertyKpis(
      input({ cashflows: [cashflow({ kind: "INCOME", amount: new Decimal("700.00") })] }),
    );

    expect(result.rentalIncome.toFixed(2)).toBe("700.00");
    expect(result.operatingExpenses.toFixed(2)).toBe("0.00");
    expect(result.noi.toFixed(2)).toBe("700.00");
    expect(result.monthsWithRent).toBe(1);
  });

  it("excludes another currency and refuses the yields it would fragment", () => {
    const result = computePropertyKpis(
      input({
        cashflows: [
          cashflow({ id: "rent", kind: "INCOME", amount: new Decimal("900.00") }),
          cashflow({
            id: "foreign",
            kind: "INCOME",
            amount: new Decimal("500.00"),
            currency: "USD",
          }),
        ],
      }),
    );

    expect(result.rentalIncome.toFixed(2)).toBe("900.00");
    expect(result.foreignCurrencyCashflows).toBe(1);
    expect(result.currencyMismatch).toBe(true);
    expect(result.grossYield.value).toBeNull();
    expect(result.grossYield.reason).toBe("CURRENCY_MISMATCH");
  });

  it("counts a transaction-linked entry exactly once", () => {
    const result = computePropertyKpis(
      input({
        cashflows: [
          cashflow({
            kind: "EXPENSE",
            // A stale amount on a linked row must never add to the transaction.
            amount: new Decimal("-999.99"),
            transaction: { id: "tx-1", label: "Travaux", amount: new Decimal("-450.00") },
          }),
        ],
      }),
    );

    expect(result.operatingExpenses.toFixed(2)).toBe("450.00");
    expect(result.noi.toFixed(2)).toBe("-450.00");
  });

  it("places a boundary entry in exactly one window", () => {
    const period = calendarYearPeriod(2025, NOW);
    const result = computePropertyKpis(
      input({
        period,
        cashflows: [
          cashflow({
            id: "first-day",
            kind: "INCOME",
            amount: new Decimal("100.00"),
            dueDate: new Date(Date.UTC(2025, 0, 1)),
          }),
          cashflow({
            id: "next-year",
            kind: "INCOME",
            amount: new Decimal("999.00"),
            dueDate: new Date(Date.UTC(2026, 0, 1)),
          }),
        ],
      }),
    );

    expect(result.rentalIncome.toFixed(2)).toBe("100.00");
    expect(result.cashflowCount).toBe(1);
    expect(result.outsidePeriodCashflows).toBe(1);
  });

  it("counts at most one rent month per month, whatever the entries", () => {
    const result = computePropertyKpis(
      input({
        cashflows: [
          cashflow({ id: "a", kind: "INCOME", amount: new Decimal("400.00") }),
          cashflow({
            id: "b",
            kind: "INCOME",
            amount: new Decimal("400.00"),
            dueDate: new Date(Date.UTC(2026, 3, 25)),
          }),
          cashflow({
            id: "c",
            kind: "INCOME",
            amount: new Decimal("400.00"),
            dueDate: new Date(Date.UTC(2026, 6, 5)),
          }),
        ],
      }),
    );

    expect(result.monthsWithRent).toBe(2);
    expect(result.rentalIncome.toFixed(2)).toBe("1200.00");
  });

  it("computes gross and net yields on the acquisition price", () => {
    const result = computePropertyKpis(
      input({
        purchasePrice: new Decimal("240000.00"),
        cashflows: [
          cashflow({ kind: "INCOME", amount: new Decimal("14400.00") }),
          cashflow({ kind: "EXPENSE", amount: new Decimal("-2400.00") }),
        ],
      }),
    );

    expect(result.grossYield.value?.toFixed(2)).toBe("6.00");
    expect(result.netYield.value?.toFixed(2)).toBe("5.00");
  });

  it("refuses a yield without a recorded acquisition price", () => {
    const result = computePropertyKpis(
      input({
        purchasePrice: null,
        cashflows: [cashflow({ kind: "INCOME", amount: new Decimal("900.00") })],
      }),
    );

    expect(result.grossYield.value).toBeNull();
    expect(result.grossYield.reason).toBe("NO_PURCHASE_PRICE");
    expect(result.netYield.reason).toBe("NO_PURCHASE_PRICE");
  });

  it("refuses the yields of the year still running instead of extrapolating", () => {
    const result = computePropertyKpis(
      input({
        period: calendarYearPeriod(2026, NOW),
        cashflows: [cashflow({ kind: "INCOME", amount: new Decimal("900.00") })],
      }),
    );

    expect(result.rentalIncome.toFixed(2)).toBe("900.00");
    expect(result.grossYield.value).toBeNull();
    expect(result.grossYield.reason).toBe("INCOMPLETE_PERIOD");
  });
});

describe("computePropertyKpis — financing", () => {
  it("is a known zero without any loan", () => {
    const result = computePropertyKpis(
      input({ cashflows: [cashflow({ kind: "INCOME", amount: new Decimal("900.00") })] }),
    );

    expect(result.financingCost.value?.toFixed(2)).toBe("0.00");
    expect(result.cashflowAfterFinancing.value?.toFixed(2)).toBe("900.00");
  });

  it("spreads payment and insurance over the twelve months of the window", () => {
    const result = computePropertyKpis(
      input({
        cashflows: [cashflow({ kind: "INCOME", amount: new Decimal("12000.00") })],
        loans: [loan()],
      }),
    );

    // (1000 + 20) × 12
    expect(result.financingCost.value?.toFixed(2)).toBe("12240.00");
    expect(result.cashflowAfterFinancing.value?.toFixed(2)).toBe("-240.00");
  });

  it("counts only the months a loan is active inside the window", () => {
    const result = computePropertyKpis(
      input({
        period: calendarYearPeriod(2025, NOW),
        loans: [
          loan({ id: "started-in-march", startDate: new Date(Date.UTC(2025, 2, 18)) }),
          loan({
            id: "repaid-in-june",
            startDate: new Date(Date.UTC(2020, 0, 1)),
            endDate: new Date(Date.UTC(2025, 5, 15)),
          }),
          loan({
            id: "already-repaid",
            startDate: new Date(Date.UTC(2015, 0, 1)),
            endDate: new Date(Date.UTC(2024, 11, 31)),
            paymentAmount: null,
            insuranceAmount: null,
          }),
        ],
      }),
    );

    // March–December (10 months) and January–June (6 months); the repaid loan is silent.
    expect(result.financingCost.value?.toFixed(2)).toBe("16320.00");
    expect(result.cashflowAfterFinancing.value?.toFixed(2)).toBe("-16320.00");
  });

  it("counts a loan without a start date over the whole window and says so", () => {
    const result = computePropertyKpis(
      input({ loans: [loan({ startDate: null })] }),
    );

    expect(result.loansWithoutStartDate).toBe(1);
    expect(result.financingCost.value?.toFixed(2)).toBe("12240.00");
  });

  it("keeps the cost unknown when a loan records neither payment nor insurance", () => {
    const result = computePropertyKpis(
      input({
        cashflows: [cashflow({ kind: "INCOME", amount: new Decimal("1200.00") })],
        loans: [loan({ paymentAmount: null, insuranceAmount: null })],
      }),
    );

    expect(result.financingCost.value).toBeNull();
    expect(result.financingCost.reason).toBe("LOAN_WITHOUT_PAYMENT");
    expect(result.cashflowAfterFinancing.value).toBeNull();
    expect(result.cashflowAfterFinancing.reason).toBe("LOAN_WITHOUT_PAYMENT");
  });

  it("never converts a loan recorded in another currency", () => {
    const result = computePropertyKpis(
      input({ loans: [loan({ currency: "CHF" })] }),
    );

    expect(result.financingCost.value).toBeNull();
    expect(result.financingCost.reason).toBe("FOREIGN_CURRENCY_LOAN");
  });
});
