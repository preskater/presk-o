"use server";

import { revalidatePath } from "next/cache";
import {
  invalidResult,
  isUniqueConstraintError,
  rejectedResult,
  unexpectedResult,
  type ActionResult,
} from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import { recordIdInput } from "@/lib/validation";
import { DEFAULT_CURRENCY } from "@/lib/money";
import { cashflowInputSchema, propertyInputSchema } from "@/modules/real-estate/domain";
import { loanInputSchema, loanUpdateSchema } from "@/modules/real-estate/loans";
import {
  createCashflow,
  createLoan,
  createProperty,
  deleteLoan,
  findLoan,
  findProperty,
  updateLoan,
} from "@/modules/real-estate/repository";
import { findTransactionRef } from "@/modules/budget/repository";

/**
 * Write Server Actions for the real-estate module.
 *
 * Same contract as the budget actions: authorisation first, validation with the
 * module schema, every identifier looked up for the signed-in owner.
 */

export async function createPropertyAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = propertyInputSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  try {
    await createProperty({
      userId: user.id,
      name: parsed.data.name,
      address: parsed.data.address,
      occupancy: parsed.data.occupancy,
      purchaseDate: parsed.data.purchaseDate,
      saleDate: parsed.data.saleDate,
      notes: parsed.data.notes,
    });
  } catch (error) {
    return unexpectedResult("createProperty", error);
  }

  revalidatePath("/real-estate");
  revalidatePath("/dashboard");
  return { status: "ok" };
}

export async function createCashflowAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = cashflowInputSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const input = parsed.data;

  const property = await findProperty(user.id, input.propertyId);
  if (!property) {
    return rejectedResult("propertyId", "Bien introuvable.");
  }

  // Exactly one of these is set: `cashflowInputSchema` enforces the exclusivity
  // that keeps a linked transaction from being counted twice.
  let currency = input.currency ?? DEFAULT_CURRENCY;

  if (input.transactionId) {
    const transaction = await findTransactionRef(user.id, input.transactionId);
    if (!transaction) {
      return rejectedResult("transactionId", "Transaction introuvable.");
    }

    // The linked transaction is the single source of truth, currency included:
    // a different one would make the property total mix two currencies.
    currency = transaction.currency;
  }

  try {
    await createCashflow({
      propertyId: property.id,
      kind: input.kind,
      label: input.label,
      amount: input.amount,
      transactionId: input.transactionId,
      currency,
      dueDate: input.dueDate,
      settledAt: input.settledAt,
      notes: input.notes,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return rejectedResult(
        "transactionId",
        "Cette transaction est déjà rattachée à un flux.",
      );
    }

    return unexpectedResult("createCashflow", error);
  }

  revalidatePath("/real-estate");
  revalidatePath("/dashboard");
  return { status: "ok" };
}

/**
 * Write Server Actions for property financing (RE-01).
 *
 * A loan never feeds the operating totals: financing is a separate concept shown
 * beside the cashflow figures. Every identifier from the browser is looked up for the
 * signed-in owner — a property or a loan from another owner simply matches nothing.
 */

export async function createLoanAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = loanInputSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const input = parsed.data;

  const property = await findProperty(user.id, input.propertyId);
  if (!property) {
    return rejectedResult("propertyId", "Bien introuvable.");
  }

  try {
    // `input.propertyId` is the identifier just looked up for this owner.
    await createLoan(input);
  } catch (error) {
    return unexpectedResult("createLoan", error);
  }

  revalidatePath("/real-estate");
  return { status: "ok" };
}

export async function updateLoanAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = loanUpdateSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const input = parsed.data;

  const existing = await findLoan(user.id, input.id);
  if (!existing) {
    return rejectedResult("id", "Prêt introuvable : il a peut-être déjà été supprimé.");
  }

  const property = await findProperty(user.id, input.propertyId);
  if (!property) {
    return rejectedResult("propertyId", "Bien introuvable.");
  }

  try {
    const { id, ...fields } = input;
    const updated = await updateLoan(user.id, id, fields);
    if (!updated) {
      return rejectedResult("id", "Prêt introuvable : il a peut-être déjà été supprimé.");
    }
  } catch (error) {
    return unexpectedResult("updateLoan", error);
  }

  revalidatePath("/real-estate");
  return { status: "ok" };
}

export async function deleteLoanAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = recordIdInput.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  try {
    const deleted = await deleteLoan(user.id, parsed.data.id);
    if (!deleted) {
      return rejectedResult("id", "Prêt introuvable : il a peut-être déjà été supprimé.");
    }
  } catch (error) {
    return unexpectedResult("deleteLoan", error);
  }

  revalidatePath("/real-estate");
  return { status: "ok" };
}
