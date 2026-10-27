import { shiftMonthKey } from "@/lib/dates";
import type { BudgetFilterValues } from "./budget-filters";
import type { BudgetTab } from "./budget-tabs";

export type FilterShortcut = { label: string; href: string; active: boolean };

/**
 * One-click filter presets for the budget page (UX-02).
 *
 * They are plain links built on the query parameters `BudgetFilters` already submits, so
 * the server reads them exactly like a filled form: no new parameter, no client state.
 *
 * Two families, on purpose:
 * - a preset ("Non pointées", "Dépenses", "Recettes") replaces the filters and keeps the
 *   month: it answers one question, it does not stack on a previous search;
 * - a period ("Mois en cours", "Mois précédent", "Tous les mois") keeps the filters and
 *   changes the window: the same question, asked about another period.
 */
export function buildFilterShortcuts({
  tab,
  monthKey,
  currentMonthKey,
  values,
  allScope = false,
  showAllScope = false,
}: {
  tab: BudgetTab;
  /** `YYYY-MM`, the month currently displayed. */
  monthKey: string;
  /** `YYYY-MM`, today's month. */
  currentMonthKey: string;
  values: BudgetFilterValues;
  allScope?: boolean;
  showAllScope?: boolean;
}): FilterShortcut[] {
  const presets: { label: string; filters: BudgetFilterValues }[] = [
    { label: "Non pointées", filters: { reconciled: false } },
    { label: "Dépenses", filters: { type: "EXPENSE" } },
    { label: "Recettes", filters: { type: "INCOME" } },
  ];

  const shortcuts: FilterShortcut[] = presets.map(({ label, filters }) => ({
    label,
    href: budgetHref(tab, monthKey, filters, false),
    active: !allScope && sameFilters(values, filters),
  }));

  shortcuts.push(
    {
      label: "Mois en cours",
      href: budgetHref(tab, currentMonthKey, values, false),
      active: !allScope && monthKey === currentMonthKey,
    },
    {
      label: "Mois précédent",
      href: budgetHref(tab, shiftMonthKey(monthKey, -1), values, false),
      active: false,
    },
  );

  if (showAllScope) {
    shortcuts.push({
      label: "Tous les mois",
      href: budgetHref(tab, monthKey, values, true),
      active: allScope,
    });
  }

  return shortcuts;
}

function budgetHref(
  tab: BudgetTab,
  monthKey: string,
  filters: BudgetFilterValues,
  allScope: boolean,
): string {
  // Same wire names and values as the GET form in `BudgetFilters`.
  const params = new URLSearchParams({ tab, month: monthKey });
  if (filters.accountId) params.set("account", filters.accountId);
  if (filters.categoryId) params.set("category", filters.categoryId);
  if (filters.type) params.set("type", filters.type);
  if (filters.reconciled !== undefined) params.set("reconciled", filters.reconciled ? "1" : "0");
  if (filters.search) params.set("q", filters.search);
  if (allScope) params.set("all", "1");

  return `/budget?${params.toString()}`;
}

function sameFilters(a: BudgetFilterValues, b: BudgetFilterValues): boolean {
  return (
    (a.accountId || undefined) === (b.accountId || undefined) &&
    (a.categoryId || undefined) === (b.categoryId || undefined) &&
    a.type === b.type &&
    a.reconciled === b.reconciled &&
    (a.search || undefined) === (b.search || undefined)
  );
}
