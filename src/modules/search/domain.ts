import {
  isSyncStale,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@/modules/integrations/domain";

/**
 * Global search (UX-01): the rules, with no I/O.
 *
 * Every result belongs to one kind, and every kind belongs to one module. A kind is
 * searched only when its module is active in the session's workspace, so a disabled
 * module never leaks rows through the search box.
 */

export const SEARCH_KINDS = [
  "transaction",
  "account",
  "property",
  "project",
  "issue",
  "milestone",
] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

/** A search below this length is not run: it would match most rows for no benefit. */
export const SEARCH_MIN_QUERY_LENGTH = 2;

/** Longer input is truncated rather than refused: a pasted paragraph is still a search. */
export const SEARCH_MAX_QUERY_LENGTH = 120;

/**
 * Strict per-kind bound. A kind returns at most this many rows and says so when more
 * exist; the page never asks for an unbounded result set.
 */
export const SEARCH_LIMIT_PER_ENTITY = 5;

export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  transaction: "Opérations",
  account: "Comptes",
  property: "Biens immobiliers",
  project: "Projets",
  issue: "Tickets et demandes",
  milestone: "Jalons",
};

/** Where "more results" leads, for the kinds whose list is truncated. */
export const SEARCH_KIND_SEE_ALL_LABELS: Record<SearchKind, string> = {
  transaction: "Rechercher dans le budget",
  account: "Ouvrir le budget",
  property: "Ouvrir l'immobilier",
  project: "Ouvrir les intégrations",
  issue: "Ouvrir les intégrations",
  milestone: "Ouvrir les intégrations",
};

export type SearchItem = {
  id: string;
  kind: SearchKind;
  title: string;
  /** Secondary line, already formatted for display. Null when there is nothing to add. */
  detail: string | null;
  href: string;
  /** True for a provider URL: rendered as a new-tab link, never fetched server-side. */
  external: boolean;
};

export type SearchGroup = {
  kind: SearchKind;
  items: SearchItem[];
  /** True when more rows exist than the bound allows. */
  truncated: boolean;
  seeAllHref: string;
};

export type SearchResults = {
  groups: SearchGroup[];
  /** Rows actually displayed, across every group. */
  total: number;
};

/**
 * The query as it will be searched, or `null` when there is nothing worth searching.
 *
 * Whitespace is collapsed so a pasted query does not build a pattern full of runs of
 * spaces. A query that is only whitespace is "no query", not "match everything".
 */
export function normalizeSearchQuery(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length < SEARCH_MIN_QUERY_LENGTH) {
    return null;
  }

  return collapsed.slice(0, SEARCH_MAX_QUERY_LENGTH);
}

/** Kinds whose module is active. The page passes the workspace's own modules. */
export function searchableKinds(active: {
  budget: boolean;
  realEstate: boolean;
  development: boolean;
}): SearchKind[] {
  return SEARCH_KINDS.filter((kind) => {
    switch (kind) {
      case "transaction":
      case "account":
        return active.budget;
      case "property":
        return active.realEstate;
      default:
        return active.development;
    }
  });
}

export const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  GITHUB: "GitHub",
  GITLAB: "GitLab",
};

/** "GitHub", "GitLab", or "GitHub et GitLab" — for a message the owner reads. */
export function providerNames(providers: readonly IntegrationProvider[]): string {
  const names = providers.map((provider) => PROVIDER_LABELS[provider]);

  if (names.length <= 1) {
    return names[0] ?? "";
  }

  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

/** One stored connection, as the freshness summary needs it. */
export type ProviderConnectionState = {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
};

/**
 * What the page must say about provider results, computed from the stored snapshots.
 *
 * Provider results are searched from the snapshots (DR-02), never by calling the
 * provider per query, so their completeness depends on the last synchronisation. The
 * four states are deliberately distinct: a failed synchronisation is not an empty
 * search, and a workspace without a connection is not a workspace without projects.
 */
export type ProviderSearchState =
  | { kind: "not_connected" }
  | { kind: "never_synced"; providers: IntegrationProvider[] }
  | { kind: "error"; providers: IntegrationProvider[]; lastSyncedAt: Date | null }
  | { kind: "ok"; lastSyncedAt: Date; stale: boolean };

export function summarizeProviderSearchState(
  connections: readonly ProviderConnectionState[],
  now: Date,
): ProviderSearchState {
  // A row that was never connected holds no snapshots: it is "not connected", not a failure.
  const active = connections.filter((connection) => connection.status !== "NOT_CONNECTED");

  if (active.length === 0) {
    return { kind: "not_connected" };
  }

  const failed = active.filter(
    (connection) => connection.status === "ERROR" || connection.lastSyncError !== null,
  );
  const lastSuccessfulSync = mostRecentSync(active);

  if (failed.length > 0) {
    return {
      kind: "error",
      providers: uniqueProviders(failed),
      lastSyncedAt: lastSuccessfulSync,
    };
  }

  if (!lastSuccessfulSync) {
    return { kind: "never_synced", providers: uniqueProviders(active) };
  }

  return {
    kind: "ok",
    lastSyncedAt: lastSuccessfulSync,
    stale: isSyncStale(lastSuccessfulSync, now),
  };
}

function mostRecentSync(connections: readonly ProviderConnectionState[]): Date | null {
  let latest: Date | null = null;

  for (const connection of connections) {
    if (connection.lastSyncedAt && (!latest || connection.lastSyncedAt > latest)) {
      latest = connection.lastSyncedAt;
    }
  }

  return latest;
}

function uniqueProviders(
  connections: readonly ProviderConnectionState[],
): IntegrationProvider[] {
  return [...new Set(connections.map((connection) => connection.provider))];
}
