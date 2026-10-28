import Decimal from "decimal.js";
import { formatDateOnly, toDateOnlyString } from "@/lib/dates";
import { getPrisma } from "@/lib/db";
import { assertCurrency, formatMoney } from "@/lib/money";
import { ACCOUNT_TYPE_LABELS, type AccountType } from "@/modules/budget/domain";
import type { IntegrationProvider, IntegrationStatus } from "@/modules/integrations/domain";
import {
  normalizeSearchQuery,
  PROVIDER_LABELS,
  SEARCH_LIMIT_PER_ENTITY,
  SEARCH_KINDS,
  summarizeProviderSearchState,
  type ProviderSearchState,
  type SearchGroup,
  type SearchItem,
  type SearchKind,
  type SearchResults,
} from "./domain";

/**
 * Global search persistence.
 *
 * Every query is scoped to the session's workspace — directly for the owner's own rows,
 * through the connection for provider snapshots — so a foreign row can never appear in
 * a result. Provider data is read from the snapshots only: a search never calls GitHub
 * or GitLab.
 *
 * Each kind is bounded by `limit + 1` rows: the extra row only tells the page that more
 * results exist, without a count query per kind.
 */

const MAX_LIMIT = 20;

export type SearchAllInput = {
  workspaceId: string;
  query: string;
  /** Only these kinds are queried. The page passes the ones whose module is active. */
  kinds: readonly SearchKind[];
  /** Defaults to `SEARCH_LIMIT_PER_ENTITY`; clamped so a caller cannot ask for everything. */
  limit?: number;
};

export async function searchAll(input: SearchAllInput): Promise<SearchResults> {
  const query = normalizeSearchQuery(input.query);
  if (!query) {
    return { groups: [], total: 0 };
  }

  const limit = clampLimit(input.limit);
  const kinds = new Set(input.kinds);

  const groups = (
    await Promise.all(
      SEARCH_KINDS.filter((kind) => kinds.has(kind)).map((kind) =>
        loaders[kind](input.workspaceId, query, limit),
      ),
    )
  ).filter((group): group is SearchGroup => group !== null);

  return {
    groups,
    total: groups.reduce((sum, group) => sum + group.items.length, 0),
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
    return SEARCH_LIMIT_PER_ENTITY;
  }

  return Math.min(limit, MAX_LIMIT);
}

type Loader = (workspaceId: string, query: string, limit: number) => Promise<SearchGroup | null>;

const loaders: Record<SearchKind, Loader> = {
  transaction: searchTransactions,
  account: searchAccounts,
  property: searchProperties,
  project: searchProjects,
  issue: searchIssues,
  milestone: searchMilestones,
};

/** Builds a group, or `null` when nothing matched so the page only renders what exists. */
function group(
  kind: SearchKind,
  rows: readonly SearchItem[],
  more: boolean,
  query: string,
): SearchGroup | null {
  if (rows.length === 0) {
    return null;
  }

  return { kind, items: [...rows], truncated: more, seeAllHref: seeAllHref(kind, query) };
}

function seeAllHref(kind: SearchKind, query: string): string {
  switch (kind) {
    case "transaction":
      // The budget's text search, widened to every month, reuses the same filter.
      return `/budget?tab=operations&all=1&q=${encodeURIComponent(query)}`;
    case "account":
      return "/budget";
    case "property":
      return "/real-estate";
    default:
      return "/integrations";
  }
}

/**
 * One movement: its label, its date and its signed amount, so two rows with the same
 * label stay distinguishable. The link opens the budget on the operation's own month.
 */
async function searchTransactions(
  workspaceId: string,
  query: string,
  limit: number,
): Promise<SearchGroup | null> {
  const rows = await getPrisma().transaction.findMany({
    where: { workspaceId, label: { contains: query, mode: "insensitive" } },
    orderBy: [{ operationDate: "desc" }, { createdAt: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      label: true,
      amount: true,
      currency: true,
      operationDate: true,
      account: { select: { name: true } },
    },
  });

  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    kind: "transaction" as const,
    title: row.label,
    detail: [
      formatDateOnly(row.operationDate),
      formatMoney({
        amount: new Decimal(row.amount.toString()),
        currency: assertCurrency(row.currency),
      }),
      row.account.name,
    ].join(" · "),
    href: `/budget?tab=operations&month=${toDateOnlyString(row.operationDate).slice(0, 7)}&q=${encodeURIComponent(row.label)}`,
    external: false,
  }));

  return group("transaction", items, rows.length > limit, query);
}

async function searchAccounts(
  workspaceId: string,
  query: string,
  limit: number,
): Promise<SearchGroup | null> {
  const rows = await getPrisma().account.findMany({
    // An archived account is no longer selectable in the budget: offering it would lead
    // to a filter that displays nothing.
    where: { workspaceId, archivedAt: null, name: { contains: query, mode: "insensitive" } },
    orderBy: { name: "asc" },
    take: limit + 1,
    select: { id: true, name: true, type: true, currency: true },
  });

  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    kind: "account" as const,
    title: row.name,
    detail: `${ACCOUNT_TYPE_LABELS[row.type as AccountType]} · ${row.currency}`,
    // Every month's operations on that account, paginated by the budget page itself.
    href: `/budget?tab=operations&all=1&account=${encodeURIComponent(row.id)}`,
    external: false,
  }));

  return group("account", items, rows.length > limit, query);
}

async function searchProperties(
  workspaceId: string,
  query: string,
  limit: number,
): Promise<SearchGroup | null> {
  const rows = await getPrisma().property.findMany({
    where: {
      workspaceId,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { address: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: limit + 1,
    select: { id: true, name: true, address: true },
  });

  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    kind: "property" as const,
    title: row.name,
    detail: row.address,
    href: `/real-estate/${encodeURIComponent(row.id)}`,
    external: false,
  }));

  return group("property", items, rows.length > limit, query);
}

async function searchProjects(
  workspaceId: string,
  query: string,
  limit: number,
): Promise<SearchGroup | null> {
  const rows = await getPrisma().projectSnapshot.findMany({
    // Snapshots carry no workspace column: the scope goes through their connection.
    where: { connection: { workspaceId }, name: { contains: query, mode: "insensitive" } },
    orderBy: { name: "asc" },
    take: limit + 1,
    select: { id: true, name: true, externalUrl: true, provider: true },
  });

  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    kind: "project" as const,
    title: row.name,
    detail: PROVIDER_LABELS[row.provider as IntegrationProvider],
    href: row.externalUrl,
    external: true,
  }));

  return group("project", items, rows.length > limit, query);
}

async function searchIssues(
  workspaceId: string,
  query: string,
  limit: number,
): Promise<SearchGroup | null> {
  const rows = await getPrisma().issueSnapshot.findMany({
    where: { connection: { workspaceId }, title: { contains: query, mode: "insensitive" } },
    orderBy: [{ activityAt: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      title: true,
      repository: true,
      number: true,
      url: true,
      kind: true,
      provider: true,
    },
  });

  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    kind: "issue" as const,
    title: row.title,
    detail: [
      `${row.repository} #${row.number}`,
      row.kind === "PULL_REQUEST" ? "Demande de fusion" : "Ticket",
      PROVIDER_LABELS[row.provider as IntegrationProvider],
    ].join(" · "),
    href: row.url,
    external: true,
  }));

  return group("issue", items, rows.length > limit, query);
}

async function searchMilestones(
  workspaceId: string,
  query: string,
  limit: number,
): Promise<SearchGroup | null> {
  const rows = await getPrisma().milestoneSnapshot.findMany({
    where: {
      connection: { workspaceId },
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { repository: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: [{ dueOn: "asc" }, { title: "asc" }],
    take: limit + 1,
    select: {
      id: true,
      title: true,
      repository: true,
      state: true,
      dueOn: true,
      url: true,
    },
  });

  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    kind: "milestone" as const,
    title: row.title,
    detail: [
      row.repository,
      row.state === "open" ? "Ouvert" : row.state === "closed" ? "Fermé" : row.state,
      row.dueOn ? `Échéance ${formatDateOnly(row.dueOn)}` : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" · "),
    href: row.url,
    external: true,
  }));

  return group("milestone", items, rows.length > limit, query);
}

/**
 * Freshness of the provider results shown next to a search.
 *
 * Read from the connection rows only — never by contacting a provider — so the page can
 * tell "nothing matched" from "the last synchronisation failed".
 */
export async function getProviderSearchState(
  workspaceId: string,
  now: Date = new Date(),
): Promise<ProviderSearchState> {
  const rows = await getPrisma().integrationConnection.findMany({
    where: { workspaceId },
    select: { provider: true, status: true, lastSyncedAt: true, lastSyncError: true },
  });

  return summarizeProviderSearchState(
    rows.map((row) => ({
      provider: row.provider as IntegrationProvider,
      status: row.status as IntegrationStatus,
      lastSyncedAt: row.lastSyncedAt,
      lastSyncError: row.lastSyncError,
    })),
    now,
  );
}
