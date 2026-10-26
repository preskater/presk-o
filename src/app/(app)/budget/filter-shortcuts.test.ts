import { describe, expect, it } from "vitest";
import { buildFilterShortcuts } from "./filter-shortcuts";

function paramsOf(href: string): Record<string, string> {
  const url = new URL(href, "http://localhost");
  expect(url.pathname).toBe("/budget");
  return Object.fromEntries(url.searchParams);
}

function byLabel(shortcuts: ReturnType<typeof buildFilterShortcuts>, label: string) {
  const shortcut = shortcuts.find((entry) => entry.label === label);
  if (!shortcut) throw new Error(`Missing shortcut ${label}`);
  return shortcut;
}

describe("buildFilterShortcuts", () => {
  const base = { tab: "operations" as const, monthKey: "2026-03", currentMonthKey: "2026-10" };

  it("replaces the filters with the preset and keeps the month and tab", () => {
    const shortcuts = buildFilterShortcuts({
      ...base,
      values: { accountId: "acc-1", search: "loyer", type: "INCOME" },
    });

    expect(paramsOf(byLabel(shortcuts, "Non pointées").href)).toEqual({
      tab: "operations",
      month: "2026-03",
      reconciled: "0",
    });
    expect(paramsOf(byLabel(shortcuts, "Dépenses").href)).toEqual({
      tab: "operations",
      month: "2026-03",
      type: "EXPENSE",
    });
  });

  it("keeps the current filters when changing the period", () => {
    const values = { accountId: "acc-1", type: "EXPENSE" as const, reconciled: true };
    const shortcuts = buildFilterShortcuts({ ...base, values, showAllScope: true });

    expect(paramsOf(byLabel(shortcuts, "Mois précédent").href)).toEqual({
      tab: "operations",
      month: "2026-02",
      account: "acc-1",
      type: "EXPENSE",
      reconciled: "1",
    });
    expect(paramsOf(byLabel(shortcuts, "Mois en cours").href).month).toBe("2026-10");
    expect(paramsOf(byLabel(shortcuts, "Tous les mois").href)).toMatchObject({
      account: "acc-1",
      all: "1",
    });
  });

  it("crosses the year boundary for the previous month", () => {
    const shortcuts = buildFilterShortcuts({ ...base, monthKey: "2026-01", values: {} });

    expect(paramsOf(byLabel(shortcuts, "Mois précédent").href).month).toBe("2025-12");
  });

  it("offers « Tous les mois » only where the page supports it", () => {
    const shortcuts = buildFilterShortcuts({ ...base, tab: "analysis", values: {} });

    expect(shortcuts.map((entry) => entry.label)).not.toContain("Tous les mois");
  });

  it("marks a preset active only when it is exactly the applied filter", () => {
    const exact = buildFilterShortcuts({ ...base, values: { type: "EXPENSE" } });
    expect(byLabel(exact, "Dépenses").active).toBe(true);
    expect(byLabel(exact, "Recettes").active).toBe(false);

    const narrower = buildFilterShortcuts({ ...base, values: { type: "EXPENSE", search: "edf" } });
    expect(byLabel(narrower, "Dépenses").active).toBe(false);

    const wide = buildFilterShortcuts({
      ...base,
      values: { type: "EXPENSE" },
      allScope: true,
      showAllScope: true,
    });
    expect(byLabel(wide, "Dépenses").active).toBe(false);
    expect(byLabel(wide, "Tous les mois").active).toBe(true);
  });

  it("marks the current month active only when it is displayed", () => {
    expect(byLabel(buildFilterShortcuts({ ...base, values: {} }), "Mois en cours").active).toBe(
      false,
    );
    expect(
      byLabel(buildFilterShortcuts({ ...base, monthKey: "2026-10", values: {} }), "Mois en cours")
        .active,
    ).toBe(true);
  });
});
