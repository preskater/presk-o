import Decimal from "decimal.js";
import type { Currency } from "@/lib/money";
import {
  resolveCashflowAmount,
  type PropertyCashflowDetail,
} from "./domain";
import type { LoanSummary } from "./loans";
import type { PropertyValuation } from "./domain";

/**
 * Property history.
 *
 * One flat list of dated events, built from the rows the property already owns —
 * nothing is stored twice and nothing is invented. The rule matters for the screen:
 * a cashflow linked to a transaction shows the **transaction's** amount, exactly like
 * the totals do, so the history and the totals can never disagree.
 */

export type PropertyHistoryKind = "PURCHASE" | "CASHFLOW" | "LOAN" | "VALUATION" | "SALE";

export type PropertyHistoryEvent = {
  id: string;
  date: Date;
  kind: PropertyHistoryKind;
  title: string;
  detail: string | null;
  /** Positive magnitude; `null` when the amount was never recorded. */
  amount: Decimal | null;
  currency: Currency;
  direction: "INFLOW" | "OUTFLOW" | "NONE";
};

const KIND_LABELS: Record<PropertyHistoryKind, string> = {
  PURCHASE: "Acquisition",
  CASHFLOW: "Flux",
  LOAN: "Financement",
  VALUATION: "Estimation",
  SALE: "Cession",
};

export function propertyHistoryKindLabel(kind: PropertyHistoryKind): string {
  return KIND_LABELS[kind];
}

export function buildPropertyHistory(input: {
  currency: Currency;
  purchaseDate: Date | null;
  purchasePrice: Decimal | null;
  estimatedValue: Decimal | null;
  estimatedValueAsOf: Date | null;
  saleDate: Date | null;
  salePrice: Decimal | null;
  cashflows: readonly PropertyCashflowDetail[];
  loans: readonly LoanSummary[];
  valuations?: readonly PropertyValuation[];
}): PropertyHistoryEvent[] {
  const events: PropertyHistoryEvent[] = [];
  const currency = input.currency;

  if (input.purchaseDate) {
    events.push({
      id: "purchase",
      date: input.purchaseDate,
      kind: "PURCHASE",
      title: "Acquisition du bien",
      detail: input.purchasePrice ? null : "Prix d'acquisition non renseigné.",
      amount: input.purchasePrice,
      currency,
      direction: "OUTFLOW",
    });
  }

  const valuations = input.valuations ?? [];
  if (valuations.length === 0 && input.estimatedValueAsOf && input.estimatedValue) {
    events.push({
      id: "valuation",
      date: input.estimatedValueAsOf,
      kind: "VALUATION",
      title: "Valeur estimée",
      detail: null,
      amount: input.estimatedValue,
      currency,
      direction: "NONE",
    });
  }

  for (const valuation of valuations) {
    events.push({
      id: `valuation-${valuation.id}`,
      date: valuation.valuedOn,
      kind: "VALUATION",
      title: "Valeur estimée",
      detail: valuation.sourceNote,
      amount: valuation.amount,
      currency: valuation.currency,
      direction: "NONE",
    });
  }

  for (const cashflow of input.cashflows) {
    const amount = safeCashflowAmount(cashflow);

    events.push({
      id: `cashflow-${cashflow.id}`,
      // A settled entry is dated by its settlement; an open one by its due date;
      // an entry with neither keeps its creation date, so it is never undated.
      date: cashflow.settledAt ?? cashflow.dueDate ?? cashflow.createdAt,
      kind: "CASHFLOW",
      title: cashflow.label,
      detail: describeCashflow(cashflow),
      amount: amount === null ? null : amount.abs(),
      currency: cashflow.currency,
      direction: cashflow.kind === "INCOME" ? "INFLOW" : "OUTFLOW",
    });
  }

  for (const loan of input.loans) {
    if (!loan.startDate) {
      continue;
    }

    events.push({
      id: `loan-${loan.id}`,
      date: loan.startDate,
      kind: "LOAN",
      title: `Prêt « ${loan.label} »`,
      detail: "Financement, hors flux d'exploitation.",
      amount: loan.initialPrincipal,
      currency: loan.currency,
      direction: "NONE",
    });
  }

  if (input.saleDate) {
    events.push({
      id: "sale",
      date: input.saleDate,
      kind: "SALE",
      title: "Cession du bien",
      detail: input.salePrice ? null : "Prix de cession non renseigné.",
      amount: input.salePrice,
      currency,
      direction: "NONE",
    });
  }

  // Most recent first; a stable sort keeps the insertion order for identical days.
  return events.sort((left, right) => right.date.getTime() - left.date.getTime());
}

function safeCashflowAmount(cashflow: PropertyCashflowDetail): Decimal | null {
  try {
    return resolveCashflowAmount(cashflow);
  } catch {
    // A legacy row with neither an amount nor a transaction is reported without a
    // figure rather than failing the whole history page.
    return null;
  }
}

function describeCashflow(cashflow: PropertyCashflowDetail): string {
  const settled = cashflow.settledAt ? "réglé" : "en attente";
  const due = cashflow.dueDate ? "échéance datée" : "sans échéance";

  if (cashflow.transaction) {
    return `Lié à la transaction « ${cashflow.transaction.label} » — ${settled}, ${due}.`;
  }

  return `${settled}, ${due}.`;
}
