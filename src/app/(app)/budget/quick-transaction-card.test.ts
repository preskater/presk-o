import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { transactionFormSchema } from "@/modules/budget/domain";

const { resolverSchemas } = vi.hoisted(() => ({ resolverSchemas: [] as unknown[] }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// The real actions import the database client; the check here is about the form's wiring.
vi.mock("./actions", () => ({
  createTransactionAction: vi.fn(),
  updateTransactionAction: vi.fn(),
}));
vi.mock("@hookform/resolvers/zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hookform/resolvers/zod")>();
  return {
    ...actual,
    zodResolver: ((schema: unknown, ...rest: unknown[]) => {
      resolverSchemas.push(schema);
      return (actual.zodResolver as (...args: unknown[]) => unknown)(schema, ...rest);
    }) as typeof actual.zodResolver,
  };
});

const { QuickTransactionCard } = await import("./quick-transaction-card");

describe("QuickTransactionCard", () => {
  it("validates with the same Zod schema as the budget page's form", () => {
    const markup = renderToStaticMarkup(
      createElement(QuickTransactionCard, {
        accounts: [{ id: "acc-1", name: "Compte fictif", type: "CHECKING", currency: "EUR" }],
        categories: [],
        labelSuggestions: [],
        today: "2026-10-22",
      }),
    );

    expect(resolverSchemas).toContain(transactionFormSchema);
    expect(resolverSchemas.every((schema) => schema === transactionFormSchema)).toBe(true);
    // The `n` shortcut finds its creation field.
    expect(markup).toContain('data-shortcut="new-transaction"');
  });
});
