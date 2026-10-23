import Decimal from "decimal.js";
import type { Currency } from "@/lib/money";
import type { PropertyTotals } from "./domain";
import type { LoanSummary } from "./loans";

/**
 * Property valuation and sale analysis (RE-02).
 *
 * The figures below are **projections**, not recommendations: they compare the
 * owner's own recorded amounts and never forecast a market price. The definition of
 * each one is written in `docs/architecture/overview.md`.
 *
 * Conventions inherited from the rest of the module:
 * - a missing amount is **unknown**, never zero (`null` travels all the way to the
 *   screen, which prints "inconnu");
 * - currencies are never converted: a price, a cashflow total and a debt must share
 *   the property's reference currency, otherwise the figure reads unknown;
 * - financing stays apart from operating cashflow: `expenses` and `income` are the
 *   operating totals, and the debt is subtracted from the proceeds separately — a
 *   loan payment is never counted twice.
 */

export type SaleStatus =
  | "SOLD"
  | "NO_ESTIMATE"
  | "UNKNOWN"
  | "BELOW_TARGET"
  | "TARGET_REACHED";

export type RecordedSale = {
  date: Date;
  /** Null for a legacy sale date recorded before the price was asked for. */
  price: Decimal | null;
  costs: Decimal | null;
  /** price − costs − debt; null when the price, the costs or the debt is unknown. */
  netProceeds: Decimal | null;
  /** netProceeds − net invested capital; null when either side is unknown. */
  gain: Decimal | null;
};

export type PropertySaleAnalysis = {
  currency: Currency;
  targetGainRate: Decimal;
  /**
   * Acquisition price + operating expenses − operating income. This is the money the
   * owner actually left in the property, rents already deducted. Null when the
   * acquisition price is unknown or the cashflow totals are in another currency.
   */
  netInvested: Decimal | null;
  /** Recorded debt (sum of the loan balances); 0 without loans, null when unknown. */
  outstandingDebt: Decimal | null;
  /** Loans whose balance was never recorded: their debt is unknown, not zero. */
  unknownLoanBalances: number;
  /** Loans in another currency than the property's: never converted, so the debt is unknown. */
  foreignCurrencyLoans: number;
  /** True when the cashflow totals use another currency than the property's prices. */
  currencyMismatch: boolean;
  /** Sale price at which proceeds would repay the net invested capital and the debt. */
  breakEvenPrice: Decimal | null;
  /** Break-even price plus the target margin on the net invested capital. */
  targetPrice: Decimal | null;
  estimatedValue: Decimal | null;
  estimatedValueAsOf: Date | null;
  /** Estimated value minus the recorded debt. */
  estimatedEquity: Decimal | null;
  /** Estimated net proceeds (value − debt) minus the net invested capital, before costs. */
  estimatedGain: Decimal | null;
  /** targetPrice − estimatedValue; positive means the target is still ahead. */
  gapToTarget: Decimal | null;
  status: SaleStatus;
  sale: RecordedSale | null;
};

export type SaleAnalysisInput = {
  currency: Currency;
  purchasePrice: Decimal | null;
  estimatedValue: Decimal | null;
  estimatedValueAsOf: Date | null;
  targetGainRate: Decimal;
  saleDate: Date | null;
  salePrice: Decimal | null;
  saleCosts: Decimal | null;
  /** Operating totals of the property, and the currency they are expressed in. */
  totals: Pick<PropertyTotals, "income" | "expenses" | "currency">;
  loans: readonly Pick<LoanSummary, "currency" | "outstandingBalance">[];
};

/**
 * Recorded debt of one property.
 *
 * A property without loans has a debt of zero — a known value. As soon as one loan
 * is in another currency or has no recorded balance, the total is unknown: summing
 * what is known would understate the debt, and converting a loan would invent a rate.
 */
export function sumOutstandingDebt(
  loans: readonly Pick<LoanSummary, "currency" | "outstandingBalance">[],
  currency: Currency,
): { debt: Decimal | null; unknownBalances: number; foreignCurrencyLoans: number } {
  let debt = new Decimal(0);
  let unknownBalances = 0;
  let foreignCurrencyLoans = 0;

  for (const loan of loans) {
    if (loan.currency !== currency) {
      foreignCurrencyLoans += 1;
      continue;
    }

    if (!loan.outstandingBalance) {
      unknownBalances += 1;
      continue;
    }

    debt = debt.plus(loan.outstandingBalance);
  }

  return {
    debt: unknownBalances > 0 || foreignCurrencyLoans > 0 ? null : debt,
    unknownBalances,
    foreignCurrencyLoans,
  };
}

/**
 * Net proceeds of a sale: price − selling costs − recorded debt.
 *
 * Both sides are mandatory: a price without its costs, or a sale whose remaining
 * debt was never recorded, would yield a figure that looks precise but is not.
 */
export function computeSaleProceeds(input: {
  salePrice: Decimal;
  saleCosts: Decimal | null;
  outstandingDebt: Decimal | null;
}): Decimal | null {
  if (input.saleCosts === null || input.outstandingDebt === null) {
    return null;
  }

  return input.salePrice.minus(input.saleCosts).minus(input.outstandingDebt);
}

export function computeSaleAnalysis(input: SaleAnalysisInput): PropertySaleAnalysis {
  const currencyMismatch = input.totals.currency !== input.currency;

  const netInvested =
    input.purchasePrice === null || currencyMismatch
      ? null
      : input.purchasePrice.plus(input.totals.expenses).minus(input.totals.income);

  const { debt, unknownBalances, foreignCurrencyLoans } = sumOutstandingDebt(
    input.loans,
    input.currency,
  );

  const breakEvenPrice =
    netInvested !== null && debt !== null ? netInvested.plus(debt) : null;

  // The margin applies to the capital still engaged. A property whose rents already
  // repaid more than it cost has no positive base: its target is then simply the
  // break-even price (do not lose money), instead of a negative gain.
  const marginBase =
    netInvested !== null && netInvested.greaterThan(0) ? netInvested : new Decimal(0);

  const targetPrice =
    breakEvenPrice === null
      ? null
      : breakEvenPrice.plus(
          marginBase.times(input.targetGainRate).dividedBy(100),
        );

  const estimatedEquity =
    input.estimatedValue !== null && debt !== null
      ? input.estimatedValue.minus(debt)
      : null;

  const estimatedGain =
    estimatedEquity !== null && netInvested !== null
      ? estimatedEquity.minus(netInvested)
      : null;

  const gapToTarget =
    targetPrice !== null && input.estimatedValue !== null
      ? targetPrice.minus(input.estimatedValue)
      : null;

  const sale = buildRecordedSale(input, debt, netInvested);

  return {
    currency: input.currency,
    targetGainRate: input.targetGainRate,
    netInvested,
    outstandingDebt: debt,
    unknownLoanBalances: unknownBalances,
    foreignCurrencyLoans,
    currencyMismatch,
    breakEvenPrice,
    targetPrice,
    estimatedValue: input.estimatedValue,
    estimatedValueAsOf: input.estimatedValueAsOf,
    estimatedEquity,
    estimatedGain,
    gapToTarget,
    status: saleStatus(input, targetPrice),
    sale,
  };
}

function buildRecordedSale(
  input: SaleAnalysisInput,
  debt: Decimal | null,
  netInvested: Decimal | null,
): RecordedSale | null {
  if (input.saleDate === null) {
    return null;
  }

  const netProceeds =
    input.salePrice === null
      ? null
      : computeSaleProceeds({
          salePrice: input.salePrice,
          saleCosts: input.saleCosts,
          outstandingDebt: debt,
        });

  const gain =
    netProceeds !== null && netInvested !== null ? netProceeds.minus(netInvested) : null;

  return {
    date: input.saleDate,
    price: input.salePrice,
    costs: input.saleCosts,
    netProceeds,
    gain,
  };
}

function saleStatus(
  input: SaleAnalysisInput,
  targetPrice: Decimal | null,
): SaleStatus {
  if (input.saleDate !== null) {
    return "SOLD";
  }

  if (input.estimatedValue === null) {
    return "NO_ESTIMATE";
  }

  if (targetPrice === null) {
    return "UNKNOWN";
  }

  return input.estimatedValue.greaterThanOrEqualTo(targetPrice)
    ? "TARGET_REACHED"
    : "BELOW_TARGET";
}
