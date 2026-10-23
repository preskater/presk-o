import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  cashflowInputSchema,
  computePropertyTotals,
  isCashflowOverdue,
  propertyInputSchema,
  propertySaleInputSchema,
  propertyUpdateSchema,
  resolveCashflowAmount,
  UnresolvedCashflowError,
  type CashflowEntry,
} from "./domain";

/** Fictitious amounts only. */
function entry(overrides: Partial<CashflowEntry> = {}): CashflowEntry {
  return {
    id: overrides.id ?? "cashflow-1",
    kind: overrides.kind ?? "EXPENSE",
    label: overrides.label ?? "Charge de test",
    currency: overrides.currency ?? "EUR",
    amount: overrides.amount ?? null,
    dueDate: overrides.dueDate ?? null,
    settledAt: overrides.settledAt ?? null,
    transaction: overrides.transaction ?? null,
  };
}

describe("resolveCashflowAmount", () => {
  it("uses the linked transaction amount", () => {
    const amount = resolveCashflowAmount(
      entry({
        transaction: { id: "tx-1", label: "Charges", amount: new Decimal("-250.00") },
      }),
    );

    expect(amount.toFixed(2)).toBe("-250.00");
  });

  it("ignores a duplicated amount on a linked entry: no double counting", () => {
    // Even if a stale row still carries an amount, the transaction wins.
    const amount = resolveCashflowAmount(
      entry({
        amount: new Decimal("-999.99"),
        transaction: { id: "tx-1", label: "Charges", amount: new Decimal("-250.00") },
      }),
    );

    expect(amount.toFixed(2)).toBe("-250.00");
  });

  it("uses its own amount for a standalone entry", () => {
    const amount = resolveCashflowAmount(entry({ amount: new Decimal("-80.00") }));

    expect(amount.toFixed(2)).toBe("-80.00");
  });

  it("refuses an entry with neither a transaction nor an amount", () => {
    expect(() => resolveCashflowAmount(entry())).toThrow(UnresolvedCashflowError);
  });
});

describe("computePropertyTotals", () => {
  it("returns zeros for a property without any entry, such as an unrented one", () => {
    const totals = computePropertyTotals([]);

    expect(totals.income.toFixed(2)).toBe("0.00");
    expect(totals.expenses.toFixed(2)).toBe("0.00");
    expect(totals.net.toFixed(2)).toBe("0.00");
  });

  it("totals standalone entries", () => {
    const totals = computePropertyTotals([
      entry({ kind: "INCOME", amount: new Decimal("900.00") }),
      entry({ id: "cashflow-2", kind: "EXPENSE", amount: new Decimal("-120.00") }),
    ]);

    expect(totals.income.toFixed(2)).toBe("900.00");
    expect(totals.expenses.toFixed(2)).toBe("120.00");
    expect(totals.net.toFixed(2)).toBe("780.00");
  });

  it("counts a transaction-linked entry exactly once", () => {
    const totals = computePropertyTotals([
      entry({
        kind: "EXPENSE",
        transaction: { id: "tx-1", label: "Travaux", amount: new Decimal("-500.00") },
      }),
    ]);

    expect(totals.expenses.toFixed(2)).toBe("500.00");
    expect(totals.net.toFixed(2)).toBe("-500.00");
  });

  it("reports expenses as a positive number even when the transaction is signed", () => {
    const totals = computePropertyTotals([
      entry({
        kind: "INCOME",
        transaction: { id: "tx-1", label: "Loyer", amount: new Decimal("750.00") },
      }),
      entry({
        id: "cashflow-2",
        kind: "EXPENSE",
        transaction: { id: "tx-2", label: "Taxe", amount: new Decimal("-200.00") },
      }),
    ]);

    expect(totals.expenses.toFixed(2)).toBe("200.00");
    expect(totals.net.toFixed(2)).toBe("550.00");
  });

  it("refuses to mix currencies in one property total", () => {
    expect(() =>
      computePropertyTotals([
        entry({ kind: "INCOME", amount: new Decimal("100.00"), currency: "EUR" }),
        entry({ id: "cashflow-2", kind: "INCOME", amount: new Decimal("100.00"), currency: "USD" }),
      ]),
    ).toThrow(/filter by currency first/);
  });
});

describe("isCashflowOverdue", () => {
  const today = new Date(Date.UTC(2026, 8, 30));

  it("is false without a due date", () => {
    expect(isCashflowOverdue({ dueDate: null, settledAt: null }, today)).toBe(false);
  });

  it("is true when the due date has passed and nothing is settled", () => {
    expect(
      isCashflowOverdue({ dueDate: new Date(Date.UTC(2026, 8, 15)), settledAt: null }, today),
    ).toBe(true);
  });

  it("is false once the entry is settled", () => {
    expect(
      isCashflowOverdue(
        { dueDate: new Date(Date.UTC(2026, 8, 15)), settledAt: new Date(Date.UTC(2026, 8, 16)) },
        today,
      ),
    ).toBe(false);
  });

  it("is false on the due date itself", () => {
    expect(
      isCashflowOverdue({ dueDate: today, settledAt: null }, today),
    ).toBe(false);
  });
});

describe("cashflowInputSchema", () => {
  it("accepts a standalone entry with an amount", () => {
    const result = cashflowInputSchema.safeParse({
      propertyId: "property-1",
      kind: "EXPENSE",
      label: "Taxe foncière",
      amount: "450,00",
      currency: "EUR",
    });

    expect(result.success).toBe(true);
  });

  it("accepts an entry linked to a transaction", () => {
    const result = cashflowInputSchema.safeParse({
      propertyId: "property-1",
      kind: "INCOME",
      label: "Loyer",
      transactionId: "tx-1",
      currency: "EUR",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an entry carrying both an amount and a transaction", () => {
    const result = cashflowInputSchema.safeParse({
      propertyId: "property-1",
      kind: "INCOME",
      label: "Loyer",
      amount: "900,00",
      transactionId: "tx-1",
      currency: "EUR",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an entry carrying neither", () => {
    const result = cashflowInputSchema.safeParse({
      propertyId: "property-1",
      kind: "INCOME",
      label: "Loyer",
      currency: "EUR",
    });

    expect(result.success).toBe(false);
  });
});

describe("propertyInputSchema", () => {
  /** Values as the HTML form sends them: everything is a string, empty means unset. */
  const formValues = {
    name: "Appartement de test",
    address: "",
    occupancy: "VACANT",
    currency: "EUR",
    purchaseDate: "",
    purchasePrice: "",
    estimatedValue: "",
    estimatedValueAsOf: "",
    targetGainRate: "10",
    notes: "",
  };

  it("accepts a property with no address, no dates, no prices and no notes", () => {
    const result = propertyInputSchema.safeParse(formValues);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      address: null,
      purchaseDate: null,
      purchasePrice: null,
      estimatedValue: null,
      estimatedValueAsOf: null,
      notes: null,
      occupancy: "VACANT",
      currency: "EUR",
    });
  });

  it("converts an acquisition date into a calendar day", () => {
    const result = propertyInputSchema.safeParse({ ...formValues, purchaseDate: "2021-06-15" });

    expect(result.data?.purchaseDate?.toISOString()).toBe("2021-06-15T00:00:00.000Z");
  });

  it("rejects an impossible date rather than shifting it", () => {
    expect(
      propertyInputSchema.safeParse({ ...formValues, estimatedValueAsOf: "2026-13-01" }).success,
    ).toBe(false);
  });

  it("requires a name", () => {
    expect(propertyInputSchema.safeParse({ ...formValues, name: "   " }).success).toBe(false);
  });

  it("keeps a missing price unknown instead of turning it into zero", () => {
    const result = propertyInputSchema.safeParse(formValues);

    expect(result.data?.purchasePrice).toBeNull();
  });

  it("refuses an estimated value that is not dated", () => {
    const result = propertyInputSchema.safeParse({ ...formValues, estimatedValue: "250000,00" });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => /doit être datée/.test(issue.message)),
    ).toBe(true);
  });

  it("refuses an estimation date without its amount", () => {
    expect(
      propertyInputSchema.safeParse({ ...formValues, estimatedValueAsOf: "2026-10-01" }).success,
    ).toBe(false);
  });

  it("refuses a non-positive acquisition price", () => {
    expect(
      propertyInputSchema.safeParse({ ...formValues, purchasePrice: "0" }).success,
    ).toBe(false);
  });

  it("falls back to a 10 % target when the field is left empty", () => {
    const result = propertyInputSchema.safeParse({ ...formValues, targetGainRate: "" });

    expect(result.data?.targetGainRate.toFixed(2)).toBe("10.00");
  });

  it("refuses a target margin above 100 %", () => {
    expect(
      propertyInputSchema.safeParse({ ...formValues, targetGainRate: "150" }).success,
    ).toBe(false);
  });

  it("accepts a dated valuation and normalises its amount", () => {
    const result = propertyInputSchema.safeParse({
      ...formValues,
      estimatedValue: "250 000,00",
      estimatedValueAsOf: "2026-10-01",
    });

    expect(result.data?.estimatedValue?.toFixed(2)).toBe("250000.00");
    expect(result.data?.estimatedValueAsOf?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("propertyUpdateSchema", () => {
  const formValues = {
    id: "property-1",
    name: "Appartement de test",
    address: "",
    occupancy: "VACANT",
    currency: "EUR",
    purchaseDate: "",
    purchasePrice: "",
    estimatedValue: "",
    estimatedValueAsOf: "",
    targetGainRate: "10",
    notes: "",
  };

  it("accepts an edit carrying its identifier", () => {
    expect(propertyUpdateSchema.safeParse(formValues).success).toBe(true);
  });

  it("refuses an edit without an identifier", () => {
    expect(propertyUpdateSchema.safeParse({ ...formValues, id: " " }).success).toBe(false);
  });
});

describe("propertySaleInputSchema", () => {
  const sale = {
    id: "property-1",
    saleDate: "2026-10-21",
    salePrice: "320000,00",
    saleCosts: "0",
  };

  it("accepts a sale with its date, price and costs", () => {
    const result = propertySaleInputSchema.safeParse(sale);

    expect(result.success).toBe(true);
    expect(result.data?.salePrice.toFixed(2)).toBe("320000.00");
    expect(result.data?.saleCosts.toFixed(2)).toBe("0.00");
  });

  it("refuses a sale without a price", () => {
    expect(propertySaleInputSchema.safeParse({ ...sale, salePrice: "" }).success).toBe(false);
  });

  it("refuses a sale without a date", () => {
    expect(propertySaleInputSchema.safeParse({ ...sale, saleDate: "" }).success).toBe(false);
  });

  it("refuses negative selling costs", () => {
    expect(propertySaleInputSchema.safeParse({ ...sale, saleCosts: "-1" }).success).toBe(false);
  });
});

describe("cashflowInputSchema, as filled by the form", () => {
  it("accepts a standalone entry: amount typed, no transaction selected", () => {
    const result = cashflowInputSchema.safeParse({
      propertyId: "property-1",
      kind: "EXPENSE",
      label: "Taxe foncière",
      amount: "-450,00",
      transactionId: "",
      currency: "EUR",
      dueDate: "",
      settledAt: "",
      notes: "",
    });

    expect(result.success).toBe(true);
    expect(result.data?.amount?.toFixed(2)).toBe("-450.00");
    expect(result.data?.transactionId).toBeNull();
    expect(result.data?.dueDate).toBeNull();
  });

  it("accepts a linked entry when the amount field is left empty", () => {
    const result = cashflowInputSchema.safeParse({
      propertyId: "property-1",
      kind: "INCOME",
      label: "Loyer",
      amount: "",
      transactionId: "tx-1",
      dueDate: "2026-10-05",
      settledAt: "",
      notes: "",
    });

    expect(result.success).toBe(true);
    expect(result.data?.amount).toBeNull();
    // No currency is sent with a linked entry: the action reads the transaction's.
    expect(result.data?.currency).toBeUndefined();
    expect(result.data?.dueDate?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("rejects an unreadable amount with a French message", () => {
    const result = cashflowInputSchema.safeParse({
      propertyId: "property-1",
      kind: "EXPENSE",
      label: "Taxe foncière",
      amount: "12,345",
      currency: "EUR",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => /Montant invalide/.test(issue.message))).toBe(true);
  });
});
