import Decimal from "decimal.js";
import type { Currency } from "@/lib/money";
import {
  cashflowEntryDate,
  resolveCashflowAmount,
  type PropertyCashflowDetail,
  type PropertyOccupancy,
} from "./domain";
import type { LoanSummary } from "./loans";

/**
 * Property performance indicators (RE-03).
 *
 * Every figure is a deterministic function of the rows the property already owns —
 * no projection, no market benchmark, no extrapolation. Definitions live in
 * `docs/architecture/overview.md`; the conventions below are the ones the rest of the
 * module already uses, and the tests pin them down:
 *
 * - **Period**: the window is always twelve whole months, so a sum over the window is
 *   an annual figure and a yield needs no annualisation. Two windows are offered: the
 *   twelve last months (current month included) and a calendar year. The current
 *   calendar year is incomplete, so its yields read unknown instead of being
 *   extrapolated.
 * - **Dating**: an entry is placed by `cashflowEntryDate` — settlement, else due date,
 *   else creation — the rule the history already uses.
 * - **Currency**: the reference currency is the property's price currency. Entries in
 *   another currency are never converted: they are excluded and counted, and the yields
 *   read unknown as soon as the window holds one, because the sums would then describe
 *   only part of the rent.
 * - **Unknown, never zero**: an indicator that cannot be computed carries a reason. A
 *   property without a cashflow in the window is reported as "no data", not as zeros.
 * - **Double counting**: `resolveCashflowAmount` keeps a transaction-linked entry to a
 *   single amount, exactly like the property totals.
 * - **Financing**: read from the loan records only (`PropertyLoan`), never from the
 *   cashflow entries: a loan payment is not an operating expense. The cost is spread
 *   over the months the loan is active inside the window.
 */

/** Query value of the twelve-month window that ends with the current month. */
export const KPI_PERIOD_TRAILING = "trailing";

/** Every window spans twelve months; see the module note above. */
export const KPI_PERIOD_MONTHS = 12;

export type KpiPeriodKind = "TRAILING_TWELVE_MONTHS" | "CALENDAR_YEAR";

export type KpiPeriod = {
  kind: KpiPeriodKind;
  /** Inclusive lower bound on the cashflow date. */
  start: Date;
  /** Exclusive upper bound, so boundary entries belong to exactly one window. */
  end: Date;
  months: number;
  /** False for the calendar year still running: its yields are not extrapolated. */
  complete: boolean;
  /** Calendar year for `CALENDAR_YEAR`, null for the rolling window. */
  year: number | null;
};

function startOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Month ordinal, used to count how many months a loan is active in a window. */
function monthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

/** The twelve months ending with the current month; the current month is partial. */
export function trailingTwelveMonthsPeriod(now: Date = new Date()): KpiPeriod {
  const currentMonth = startOfMonthUtc(now);

  return {
    kind: "TRAILING_TWELVE_MONTHS",
    start: new Date(
      Date.UTC(
        currentMonth.getUTCFullYear(),
        currentMonth.getUTCMonth() - (KPI_PERIOD_MONTHS - 1),
        1,
      ),
    ),
    end: new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + 1, 1)),
    months: KPI_PERIOD_MONTHS,
    complete: true,
    year: null,
  };
}

/** A calendar year, complete unless it is the year still running. */
export function calendarYearPeriod(year: number, now: Date = new Date()): KpiPeriod {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw new RangeError(`Invalid KPI year: ${year}`);
  }

  return {
    kind: "CALENDAR_YEAR",
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
    months: KPI_PERIOD_MONTHS,
    complete: year < now.getUTCFullYear(),
    year,
  };
}

/**
 * Reads `?period=` and falls back to the rolling window.
 *
 * Anything malformed, in the future or before 1970 falls back rather than failing the
 * page: a hand-edited URL must never crash the property screen.
 */
export function resolveKpiPeriod(
  value: string | null | undefined,
  now: Date = new Date(),
): KpiPeriod {
  if (typeof value === "string" && /^\d{4}$/.test(value)) {
    const year = Number(value);
    if (year >= 1970 && year <= now.getUTCFullYear()) {
      return calendarYearPeriod(year, now);
    }
  }

  return trailingTwelveMonthsPeriod(now);
}

/** French label of a window, used by the selector and the indicator card. */
export function kpiPeriodLabel(period: KpiPeriod): string {
  if (period.kind === "CALENDAR_YEAR") {
    return period.complete ? `Année ${period.year}` : `Année ${period.year} (en cours)`;
  }

  return "12 derniers mois";
}

/**
 * The years to offer in the selector: from the oldest dated fact of the property to
 * the current year, most recent first. A year is offered only when something is dated
 * in it, so the list never proposes empty placeholders.
 */
export function availableKpiYears(input: {
  purchaseDate: Date | null;
  cashflows: readonly Pick<PropertyCashflowDetail, "settledAt" | "dueDate" | "createdAt">[];
  loans: readonly Pick<LoanSummary, "startDate">[];
  now?: Date;
}): number[] {
  const currentYear = (input.now ?? new Date()).getUTCFullYear();
  const years = new Set<number>([currentYear]);

  const remember = (date: Date | null) => {
    if (!date) {
      return;
    }
    const year = date.getUTCFullYear();
    if (year >= 1970 && year <= currentYear) {
      years.add(year);
    }
  };

  remember(input.purchaseDate);
  for (const cashflow of input.cashflows) {
    remember(cashflowEntryDate(cashflow));
  }
  for (const loan of input.loans) {
    remember(loan.startDate);
  }

  return [...years].sort((left, right) => right - left);
}

/** Why an indicator is unknown. Printed next to the figure, never inferred from zero. */
export type KpiUnavailableReason =
  | "NO_DATA"
  | "INCOMPLETE_PERIOD"
  | "NO_PURCHASE_PRICE"
  | "CURRENCY_MISMATCH"
  | "LOAN_WITHOUT_PAYMENT"
  | "FOREIGN_CURRENCY_LOAN";

/** A figure that is either known or explicitly unknown, never silently zero. */
export type KpiFigure = {
  value: Decimal | null;
  reason: KpiUnavailableReason | null;
};

function known(value: Decimal): KpiFigure {
  return { value, reason: null };
}

function unknown(reason: KpiUnavailableReason): KpiFigure {
  return { value: null, reason };
}

export type PropertyKpiInput = {
  /** Reference currency: the property's price currency. Nothing is ever converted. */
  currency: Currency;
  occupancy: PropertyOccupancy;
  purchasePrice: Decimal | null;
  cashflows: readonly PropertyCashflowDetail[];
  loans: readonly LoanSummary[];
  period: KpiPeriod;
};

export type PropertyKpiResult = {
  currency: Currency;
  period: KpiPeriod;
  /** Window chosen by the owner, or the rolling window by default. */
  occupancy: PropertyOccupancy;
  /** In-window entries of every currency. Zero means "nothing recorded", not "zero". */
  cashflowCount: number;
  /** Entries dated outside the window: they contribute nothing. */
  outsidePeriodCashflows: number;
  /** In-window entries in another currency: excluded and counted, never converted. */
  foreignCurrencyCashflows: number;
  /** In-window entries the totals could not resolve (no amount, no transaction). */
  unresolvedCashflows: number;
  /** In-window entries in the reference currency: the ones actually summed. */
  inCurrencyCashflows: number;
  /** True when at least one in-window entry is not in the reference currency. */
  currencyMismatch: boolean;
  rentalIncome: Decimal;
  operatingExpenses: Decimal;
  /** Net operating income: rental income − operating expenses. */
  noi: Decimal;
  /** Sum of the loan payments and insurances of the months the loans are active. */
  financingCost: KpiFigure;
  /** NOI − financing cost; unknown as soon as the financing cost is. */
  cashflowAfterFinancing: KpiFigure;
  /** Rental income / acquisition price, in percent. */
  grossYield: KpiFigure;
  /** NOI / acquisition price, in percent. */
  netYield: KpiFigure;
  /** Months of the window with at least one recorded rent (0–`period.months`). */
  monthsWithRent: number;
  /** Loans counted over the whole window because they record no start date. */
  loansWithoutStartDate: number;
};

/**
 * How many months of the window a loan is active for.
 *
 * The count is monthly: a loan started on the 20th costs a full monthly payment for
 * that month, because that is how a lender bills it. A loan repaid before the window
 * contributes nothing, and one that records no start date is counted over the whole
 * window and reported in `loansWithoutStartDate` rather than silently excluded.
 */
function activeMonths(loan: Pick<LoanSummary, "startDate" | "endDate">, period: KpiPeriod): number {
  const from = loan.startDate ? startOfMonthUtc(loan.startDate) : period.start;
  const endExclusive = loan.endDate
    ? new Date(Date.UTC(loan.endDate.getUTCFullYear(), loan.endDate.getUTCMonth() + 1, 1))
    : period.end;

  const first = Math.max(monthIndex(from), monthIndex(period.start));
  const last = Math.min(monthIndex(endExclusive), monthIndex(period.end));

  return Math.min(Math.max(last - first, 0), period.months);
}

function yieldPercent(amount: Decimal, price: Decimal): Decimal {
  return amount.dividedBy(price).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * The property indicators for one window.
 *
 * Returns every figure together with what it is made of, so the screen can state why a
 * number is unknown instead of printing a zero: a property with no rent in the window
 * has a real rental income of 0, but a property with no cashflow at all has *no data*.
 */
export function computePropertyKpis(input: PropertyKpiInput): PropertyKpiResult {
  const { currency, period } = input;

  let rentalIncome = new Decimal(0);
  let operatingExpenses = new Decimal(0);
  let cashflowCount = 0;
  let outsidePeriodCashflows = 0;
  let foreignCurrencyCashflows = 0;
  let unresolvedCashflows = 0;
  let inCurrencyCashflows = 0;
  const rentMonths = new Set<number>();

  for (const cashflow of input.cashflows) {
    const date = cashflowEntryDate(cashflow);

    if (date.getTime() < period.start.getTime() || date.getTime() >= period.end.getTime()) {
      outsidePeriodCashflows += 1;
      continue;
    }

    cashflowCount += 1;

    let amount: Decimal;
    try {
      amount = resolveCashflowAmount(cashflow);
    } catch {
      // A legacy row with neither an amount nor a transaction contributes nothing.
      unresolvedCashflows += 1;
      continue;
    }

    if (cashflow.currency !== currency) {
      foreignCurrencyCashflows += 1;
      continue;
    }

    inCurrencyCashflows += 1;

    if (cashflow.kind === "INCOME") {
      rentalIncome = rentalIncome.plus(amount);
      rentMonths.add(monthIndex(date));
    } else {
      operatingExpenses = operatingExpenses.plus(amount.abs());
    }
  }

  const noi = rentalIncome.minus(operatingExpenses);

  let financingTotal = new Decimal(0);
  let financingUnknownReason: KpiUnavailableReason | null = null;
  let loansWithoutStartDate = 0;

  for (const loan of input.loans) {
    const months = activeMonths(loan, period);
    if (months === 0) {
      // Repaid before the window: no cost, and no missing figure to report.
      continue;
    }

    if (loan.currency !== currency) {
      financingUnknownReason ??= "FOREIGN_CURRENCY_LOAN";
      continue;
    }

    if (!loan.paymentAmount && !loan.insuranceAmount) {
      financingUnknownReason ??= "LOAN_WITHOUT_PAYMENT";
      continue;
    }

    if (!loan.startDate) {
      loansWithoutStartDate += 1;
    }

    const monthly = (loan.paymentAmount ?? new Decimal(0)).plus(
      loan.insuranceAmount ?? new Decimal(0),
    );
    financingTotal = financingTotal.plus(monthly.times(months));
  }

  const financingCost =
    financingUnknownReason === null
      ? known(financingTotal)
      : unknown(financingUnknownReason);

  const cashflowAfterFinancing =
    financingCost.value === null
      ? // `reason` is set whenever the value is null; the fallback only satisfies the type.
        unknown(financingCost.reason ?? "LOAN_WITHOUT_PAYMENT")
      : known(noi.minus(financingCost.value));

  // A yield is the ratio of an annual figure to the acquisition price, so it needs a
  // complete window and a known price. Both yields share the same precondition.
  const yieldUnavailableReason: KpiUnavailableReason | null =
    cashflowCount === 0
      ? "NO_DATA"
      : !period.complete
        ? "INCOMPLETE_PERIOD"
        : input.purchasePrice === null || input.purchasePrice.lessThanOrEqualTo(0)
          ? "NO_PURCHASE_PRICE"
          : foreignCurrencyCashflows > 0
            ? "CURRENCY_MISMATCH"
            : null;

  const price = input.purchasePrice;

  const grossYield =
    yieldUnavailableReason !== null
      ? unknown(yieldUnavailableReason)
      : price === null
        ? unknown("NO_PURCHASE_PRICE")
        : known(yieldPercent(rentalIncome, price));

  const netYield =
    yieldUnavailableReason !== null
      ? unknown(yieldUnavailableReason)
      : price === null
        ? unknown("NO_PURCHASE_PRICE")
        : known(yieldPercent(noi, price));

  return {
    currency,
    period,
    occupancy: input.occupancy,
    cashflowCount,
    outsidePeriodCashflows,
    foreignCurrencyCashflows,
    unresolvedCashflows,
    inCurrencyCashflows,
    currencyMismatch: foreignCurrencyCashflows > 0,
    rentalIncome,
    operatingExpenses,
    noi,
    financingCost,
    cashflowAfterFinancing,
    grossYield,
    netYield,
    monthsWithRent: rentMonths.size,
    loansWithoutStartDate,
  };
}
