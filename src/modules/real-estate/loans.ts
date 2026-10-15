import Decimal from "decimal.js";
import { z } from "zod";
import { type Currency } from "@/lib/money";
import { toDateOnlyString } from "@/lib/dates";
import {
  amount,
  currencyCode,
  optionalAmount,
  optionalDate,
  optionalInt,
  optionalText,
} from "@/lib/validation";

/**
 * Property financing.
 *
 * A loan funds a property; its interest, principal and insurance are the **cost of
 * owning** the asset, not its operating result. This file therefore keeps financing
 * entirely apart from `domain.ts` (operating cashflow): nothing here feeds
 * `computePropertyTotals`, so a property's operating totals never double-count money
 * that also appears in the budget.
 *
 * Two conventions this module inherits:
 * - a missing figure is **unknown**, never zero: `outstandingBalance`, the rate and
 *   the monthly amounts are all optional, and a `null` reads "inconnu";
 * - currencies are never converted: every total is computed per currency.
 */

export type LoanSummary = {
  id: string;
  propertyId: string;
  label: string;
  currency: Currency;
  /** Positive magnitude: the amount borrowed. */
  initialPrincipal: Decimal;
  /** Stored snapshot; `null` means "not recorded yet". */
  outstandingBalance: Decimal | null;
  balanceAsOf: Date | null;
  /** Annual rate as a percentage; `null` = not recorded. */
  interestRate: Decimal | null;
  termMonths: number | null;
  paymentAmount: Decimal | null;
  insuranceAmount: Decimal | null;
  startDate: Date | null;
  endDate: Date | null;
  notes: string | null;
};

export type LoanTotals = {
  currency: Currency;
  /**
   * Sum of one loan's monthly payment + insurance for every loan of this currency
   * that records at least one of them; `null` when no loan does — nothing recorded is
   * not a monthly cost of zero.
   */
  monthlyCost: Decimal | null;
  /**
   * Sum of the recorded outstanding balances of this currency; `null` when none is
   * recorded. Loans without a balance are excluded and counted in `unknownBalances`.
   */
  outstandingDebt: Decimal | null;
  /** How many loans of this currency carry no outstanding balance. */
  unknownBalances: number;
};

/**
 * Financing totals for one currency.
 *
 * Mixing currencies would produce a meaningless total, so a mismatch throws instead of
 * guessing a rate (same rule as `computePropertyTotals`). The caller groups loans by
 * currency and calls this once per currency.
 */
export function computeLoanTotals(
  loans: readonly LoanSummary[],
  options: { currency?: Currency } = {},
): LoanTotals {
  const currency = options.currency ?? loans[0]?.currency ?? "EUR";

  let monthlyCost: Decimal | null = null;
  let outstandingDebt: Decimal | null = null;
  let unknownBalances = 0;

  for (const loan of loans) {
    if (loan.currency !== currency) {
      throw new Error(
        `Cannot total ${loan.currency} and ${currency} loans: filter by currency first.`,
      );
    }

    const monthly =
      (loan.paymentAmount ?? new Decimal(0)).plus(loan.insuranceAmount ?? new Decimal(0));

    if (loan.paymentAmount || loan.insuranceAmount) {
      monthlyCost = (monthlyCost ?? new Decimal(0)).plus(monthly);
    }

    if (loan.outstandingBalance) {
      outstandingDebt = (outstandingDebt ?? new Decimal(0)).plus(loan.outstandingBalance);
    } else {
      unknownBalances += 1;
    }
  }

  return { currency, monthlyCost, outstandingDebt, unknownBalances };
}

const POSITIVE_MESSAGE = "La valeur doit être supérieure à zéro.";

/** A required positive magnitude, using the shared two-decimal amount parser. */
const positiveAmount = amount.refine((value) => value.greaterThan(0), POSITIVE_MESSAGE);

/** An optional non-negative magnitude: empty has no business rule, a value is checked. */
const optionalPositiveAmount = optionalAmount.refine(
  (value) => value === null || value.greaterThan(0),
  POSITIVE_MESSAGE,
);

/**
 * Input contract for a loan.
 *
 * The rate reuses the two-decimal amount parser, restrained to a positive percentage.
 * A recorded outstanding balance must carry its observation date, and the end date
 * must not precede the start date: both are cross-field rules no single field can see.
 */
const loanFields = z.object({
  propertyId: z.string().trim().min(1, "Un bien est requis."),
  label: z.string().trim().min(1, "Le libellé est requis.").max(120),
  currency: currencyCode.default("EUR"),
  initialPrincipal: positiveAmount,
  outstandingBalance: optionalPositiveAmount,
  balanceAsOf: optionalDate,
  interestRate: optionalPositiveAmount,
  termMonths: optionalInt,
  paymentAmount: optionalPositiveAmount,
  insuranceAmount: optionalPositiveAmount,
  startDate: optionalDate,
  endDate: optionalDate,
  notes: optionalText(2000, "Les notes sont limitées à 2000 caractères."),
});

type LoanFields = z.infer<typeof loanFields>;

/** A recorded balance must be dated; and an end date must not precede the start date. */
function balanceIsDated(value: LoanFields): boolean {
  return Boolean(value.outstandingBalance) === Boolean(value.balanceAsOf);
}

function datesAreOrdered(value: LoanFields): boolean {
  if (!value.startDate || !value.endDate) {
    return true;
  }
  return value.endDate.getTime() >= value.startDate.getTime();
}

const BALANCE_MESSAGE =
  "Un solde doit être daté : renseignez le montant et sa date (« au ») ensemble.";
const DATES_MESSAGE = "La date de fin doit suivre la date de début.";

export const loanInputSchema = loanFields
  .refine(balanceIsDated, { message: BALANCE_MESSAGE, path: ["balanceAsOf"] })
  .refine(datesAreOrdered, { message: DATES_MESSAGE, path: ["endDate"] });

export type LoanInput = z.input<typeof loanInputSchema>;
export type ValidatedLoanInput = z.output<typeof loanInputSchema>;

/** Same rules plus the identifier, for an in-place edit. */
const loanUpdateFields = loanFields.extend({
  id: z.string().trim().min(1, "Identifiant manquant."),
});

export const loanUpdateSchema = loanUpdateFields
  .refine(balanceIsDated, { message: BALANCE_MESSAGE, path: ["balanceAsOf"] })
  .refine(datesAreOrdered, { message: DATES_MESSAGE, path: ["endDate"] });

export type LoanUpdateInput = z.input<typeof loanUpdateSchema>;

/**
 * A loan reduced to strings for the edit form.
 *
 * A client component never receives a `Decimal` or a `Date`: the amounts are formatted
 * and the calendar days serialised to `YYYY-MM-DD`, exactly like a transaction form.
 */
export function toLoanFormInitialValues(loan: LoanSummary): {
  id: string;
  propertyId: string;
  label: string;
  currency: Currency;
  initialPrincipal: string;
  outstandingBalance: string;
  balanceAsOf: string;
  interestRate: string;
  termMonths: string;
  paymentAmount: string;
  insuranceAmount: string;
  startDate: string;
  endDate: string;
  notes: string;
} {
  return {
    id: loan.id,
    propertyId: loan.propertyId,
    label: loan.label,
    currency: loan.currency,
    initialPrincipal: loan.initialPrincipal.toFixed(2),
    outstandingBalance: loan.outstandingBalance ? loan.outstandingBalance.toFixed(2) : "",
    balanceAsOf: loan.balanceAsOf ? toDateOnlyString(loan.balanceAsOf) : "",
    interestRate: loan.interestRate ? loan.interestRate.toFixed(2) : "",
    termMonths: loan.termMonths !== null ? String(loan.termMonths) : "",
    paymentAmount: loan.paymentAmount ? loan.paymentAmount.toFixed(2) : "",
    insuranceAmount: loan.insuranceAmount ? loan.insuranceAmount.toFixed(2) : "",
    startDate: loan.startDate ? toDateOnlyString(loan.startDate) : "",
    endDate: loan.endDate ? toDateOnlyString(loan.endDate) : "",
    notes: loan.notes ?? "",
  };
}
