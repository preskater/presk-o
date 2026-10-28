import type Decimal from "decimal.js";
import { parseDateOnly, toDateOnlyString } from "@/lib/dates";
import { sumMoney, type Currency, type Money } from "@/lib/money";
import { assertActuality, type Actuality } from "./actuality";
import { costMoney } from "./money";
import {
  createCostSource,
  type CostSourceInput,
  type CostSourceReference,
} from "./source";

/**
 * A cost amount that says where it comes from and how far it can be trusted.
 *
 * This is the shared primitive of the cost ledger: no amount exists without an
 * actuality and a source. `money: null` means **unknown** and must never be
 * replaced with zero — a missing provider return is not a free month.
 */

export type CostMoneyInput = {
  amount: Decimal.Value;
  currency: string;
};

export type CostAmountInput = {
  /** `null` means unknown. An omitted value is rejected, not treated as zero. */
  money: CostMoneyInput | null;
  actuality: Actuality | string;
  source: CostSourceInput | CostSourceReference;
  /** Calendar day: `YYYY-MM-DD`, or a `Date` read as a UTC date. */
  operationDate: Date | string;
};

export type CostAmount = {
  readonly money: Money | null;
  readonly actuality: Actuality;
  readonly source: CostSourceReference;
  /** Calendar day (`YYYY-MM-DD`), distinct from the source's capture instant. */
  readonly operationDate: string;
};

export class InvalidCostAmountError extends Error {
  constructor(readonly field: string, reason: string) {
    super(`Invalid cost amount ${field}: ${reason}`);
    this.name = "InvalidCostAmountError";
  }
}

function toOperationDate(value: Date | string | undefined): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new InvalidCostAmountError("operationDate", "expected a valid date");
    }

    return toDateOnlyString(value);
  }

  if (typeof value !== "string") {
    throw new InvalidCostAmountError(
      "operationDate",
      "expected a calendar day in the YYYY-MM-DD format",
    );
  }

  try {
    parseDateOnly(value);
  } catch {
    throw new InvalidCostAmountError(
      "operationDate",
      "expected a calendar day in the YYYY-MM-DD format",
    );
  }

  return value;
}

function toMoney(value: unknown): Money | null {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    throw new InvalidCostAmountError(
      "money",
      "must be a Money value or an explicit null for unknown",
    );
  }

  if (typeof value !== "object") {
    throw new InvalidCostAmountError(
      "money",
      "must be a Money value or an explicit null for unknown",
    );
  }

  const input = value as Partial<CostMoneyInput>;

  return costMoney(input.amount as Decimal.Value, input.currency as string);
}

/**
 * Builds a frozen amount. The source is rebuilt through `createCostSource`, so
 * a hand-written object cannot bypass the secret-shaped value check.
 */
export function createCostAmount(input: CostAmountInput): CostAmount {
  const actuality = assertActuality(
    (input as { actuality?: unknown } | null | undefined)?.actuality,
  );
  const source = createCostSource(
    (input as { source: CostSourceInput }).source,
  );

  return Object.freeze({
    money: toMoney((input as { money?: unknown }).money),
    actuality,
    source,
    operationDate: toOperationDate(
      (input as { operationDate?: Date | string }).operationDate,
    ),
  });
}

export function isKnownCostAmount(amount: CostAmount): boolean {
  return amount.money !== null;
}

/**
 * Adds known amounts of one currency.
 *
 * Returns `null` when the set is empty (no data is not a zero cost) and when
 * any amount is unknown (a partial total would hide the missing figure). Mixed
 * currencies throw instead of inventing an exchange rate.
 */
export function sumCostAmounts(
  amounts: readonly CostAmount[],
  currency?: Currency,
): Money | null {
  if (amounts.length === 0) {
    return null;
  }

  if (amounts.some((amount) => amount.money === null)) {
    return null;
  }

  return sumMoney(
    amounts.map((amount) => amount.money as Money),
    currency,
  );
}
