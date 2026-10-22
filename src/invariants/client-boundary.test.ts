import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { parseDateOnly } from "@/lib/dates";
import { parseAmountInput } from "@/lib/money";
import { toBudgetFormInitialValues, toTransactionFormInitialValues, type TransactionRecord } from "@/modules/budget/domain";
import { toGoalFormInitialValues } from "@/modules/budget/goals";
import { toRecurringEntryFormInitialValues } from "@/modules/budget/recurrence";
import { nonPlainPaths } from "./helpers";

const ROOT = process.cwd();
const DAY = new Date("2026-03-31T00:00:00.000Z");

/**
 * Invariant 6 — the DTOs handed to client forms are plain data: strings, numbers,
 * booleans and null, unchanged by a JSON round trip, and still saying the same amount
 * and the same calendar day.
 */
describe("invariant: DTO serialisation", () => {
  const transaction: TransactionRecord = {
    id: "transaction-fixture",
    type: "EXPENSE",
    amount: new Decimal("-1234.50"),
    currency: "EUR",
    operationDate: DAY,
    label: "Courses fictives",
    accountId: "account-fixture",
    accountName: "Compte fictif",
    categoryId: null,
    categoryName: null,
    notes: null,
    externalRef: null,
    transferGroupId: null,
    reconciledAt: DAY,
    createdAt: DAY,
  };

  const dtos = {
    transaction: toTransactionFormInitialValues(transaction),
    budget: toBudgetFormInitialValues({
      id: "budget-fixture",
      categoryId: "category-fixture",
      categoryName: "Fictive",
      categoryKind: "EXPENSE",
      year: 2026,
      month: 3,
      currency: "EUR",
      amount: new Decimal("400"),
    }),
    goal: toGoalFormInitialValues({
      id: "goal-fixture",
      name: "Objectif fictif",
      targetAmount: new Decimal("5000.00"),
      currency: "EUR",
      targetDate: DAY,
      status: "ACTIVE",
      currentAmount: new Decimal("0.10"),
      accountId: null,
      accountName: null,
    }),
    recurring: toRecurringEntryFormInitialValues({
      id: "recurring-fixture",
      accountId: "account-fixture",
      accountName: "Compte fictif",
      categoryId: null,
      categoryName: null,
      type: "EXPENSE",
      label: "Abonnement fictif",
      amount: new Decimal("9.99"),
      frequency: "MONTHLY",
      startDate: DAY,
      endDate: null,
    }),
  };

  it.each(Object.entries(dtos))("%s DTO is plain and survives a JSON round trip", (_name, dto) => {
    expect(nonPlainPaths(dto)).toEqual([]);
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });

  it("keeps the exact amount and the calendar day", () => {
    expect(parseAmountInput(dtos.transaction.amount).equals(transaction.amount)).toBe(true);
    expect(parseDateOnly(dtos.transaction.operationDate).getTime()).toBe(DAY.getTime());
    expect(dtos.recurring.endDate).toBe("");
  });

  it("negative control: a Decimal or a Date inside a value is reported with its path", () => {
    expect(nonPlainPaths({ rows: [{ amount: new Decimal("1") }], day: DAY, label: "ok" })).toEqual([
      "$.rows[0].amount",
      "$.day",
    ]);
    // And it is exactly what JSON would silently change.
    expect(JSON.parse(JSON.stringify({ day: DAY })).day).not.toBe(DAY);
  });
});

/** Every `"use client"` module under src, as repository-relative paths. */
function clientFiles(): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (entry === "generated" || entry === "node_modules") continue;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry) && /^["']use client["']/.test(readFileSync(path, "utf8"))) {
        found.push(relative(ROOT, path));
      }
    }
  };
  walk(join(ROOT, "src"));
  return found.sort();
}

/** Imports a client module must never have: they reach the database, secrets or the session. */
const SERVER_ONLY = [
  /from "@\/lib\/db"/,
  /from "@\/generated\/prisma/,
  /from "@\/modules\/[\w-]+\/repository"/,
  /from "@\/lib\/auth\/guard"/,
  /from "@\/lib\/crypto"/,
  /from "@\/auth"/,
];

function serverOnlyImports(source: string): string[] {
  return SERVER_ONLY.filter((pattern) => pattern.test(source)).map(String);
}

/**
 * Invariant 7 (runtime side) — the compile-time check in `client-props.ts` covers every
 * client module, and no client module imports server-only code.
 */
describe("invariant: client component boundary", () => {
  it("the compile-time props check lists every \"use client\" module", () => {
    const listed = [...readFileSync(join(ROOT, "src/invariants/client-props.ts"), "utf8").matchAll(/^ {2}"([^"]+)": typeof import/gm)]
      .map((match) => match[1])
      .sort();

    expect(listed).toEqual(clientFiles());
  });

  it("no client module imports the database, Prisma, a repository, the guard or secrets", () => {
    const offenders = clientFiles().flatMap((file) =>
      serverOnlyImports(readFileSync(join(ROOT, file), "utf8")).map((pattern) => `${file}: ${pattern}`),
    );
    expect(offenders).toEqual([]);
  });

  it("negative control: the import check flags a client module reading a repository", () => {
    expect(serverOnlyImports('"use client";\nimport { listAccounts } from "@/modules/budget/repository";')).toHaveLength(1);
    expect(serverOnlyImports('"use client";\nimport { formatMoney } from "@/lib/money";')).toEqual([]);
  });
});
