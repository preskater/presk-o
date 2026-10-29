import { describe, expect, it } from "vitest";
import {
  normalizeSearchQuery,
  providerNames,
  searchableKinds,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
  summarizeProviderSearchState,
  type ProviderConnectionState,
} from "./domain";

const NOW = new Date("2026-10-28T12:00:00Z");
const ONE_HOUR_AGO = new Date("2026-10-28T11:00:00Z");
const TWO_DAYS_AGO = new Date("2026-10-26T12:00:00Z");

function connection(overrides: Partial<ProviderConnectionState> = {}): ProviderConnectionState {
  return {
    provider: "GITHUB",
    status: "CONNECTED",
    lastSyncedAt: ONE_HOUR_AGO,
    lastSyncError: null,
    ...overrides,
  };
}

describe("normalizeSearchQuery", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeSearchQuery("  loyer   appartement  ")).toBe("loyer appartement");
  });

  it("treats a query shorter than the minimum as no query", () => {
    expect(SEARCH_MIN_QUERY_LENGTH).toBe(2);
    expect(normalizeSearchQuery(" a ")).toBeNull();
    expect(normalizeSearchQuery("   ")).toBeNull();
    expect(normalizeSearchQuery("")).toBeNull();
    expect(normalizeSearchQuery(undefined)).toBeNull();
    expect(normalizeSearchQuery(null)).toBeNull();
  });

  it("truncates a long pasted query instead of refusing it", () => {
    const long = "a".repeat(SEARCH_MAX_QUERY_LENGTH + 40);
    expect(normalizeSearchQuery(long)).toHaveLength(SEARCH_MAX_QUERY_LENGTH);
  });
});

describe("searchableKinds", () => {
  it("only searches the modules active in the workspace", () => {
    expect(searchableKinds({ budget: true, realEstate: false, development: false })).toEqual([
      "transaction",
      "account",
    ]);
    expect(searchableKinds({ budget: false, realEstate: true, development: false })).toEqual([
      "property",
    ]);
    expect(searchableKinds({ budget: false, realEstate: false, development: true })).toEqual([
      "project",
      "issue",
      "milestone",
    ]);
  });

  it("searches nothing when no module is active", () => {
    expect(searchableKinds({ budget: false, realEstate: false, development: false })).toEqual([]);
  });
});

describe("summarizeProviderSearchState", () => {
  it("reports not connected without an active connection", () => {
    expect(summarizeProviderSearchState([], NOW)).toEqual({ kind: "not_connected" });
    expect(
      summarizeProviderSearchState([connection({ status: "NOT_CONNECTED", lastSyncedAt: null })], NOW),
    ).toEqual({ kind: "not_connected" });
  });

  it("reports a connection that never synchronised", () => {
    expect(summarizeProviderSearchState([connection({ lastSyncedAt: null })], NOW)).toEqual({
      kind: "never_synced",
      providers: ["GITHUB"],
    });
  });

  it("reports a failure over a healthy provider, keeping the last successful date", () => {
    const state = summarizeProviderSearchState(
      [
        connection({ provider: "GITHUB", lastSyncedAt: TWO_DAYS_AGO }),
        connection({
          provider: "GITLAB",
          status: "ERROR",
          lastSyncedAt: null,
          lastSyncError: "UNAUTHORIZED (HTTP 401)",
        }),
      ],
      NOW,
    );

    expect(state).toEqual({ kind: "error", providers: ["GITLAB"], lastSyncedAt: TWO_DAYS_AGO });
  });

  it("reports a fresh synchronisation as current", () => {
    expect(summarizeProviderSearchState([connection()], NOW)).toEqual({
      kind: "ok",
      lastSyncedAt: ONE_HOUR_AGO,
      stale: false,
    });
  });

  it("marks a synchronisation older than a day as stale", () => {
    expect(summarizeProviderSearchState([connection({ lastSyncedAt: TWO_DAYS_AGO })], NOW)).toEqual({
      kind: "ok",
      lastSyncedAt: TWO_DAYS_AGO,
      stale: true,
    });
  });
});

describe("providerNames", () => {
  it("reads like a sentence", () => {
    expect(providerNames(["GITHUB"])).toBe("GitHub");
    expect(providerNames(["GITLAB"])).toBe("GitLab");
    expect(providerNames(["GITHUB", "GITLAB"])).toBe("GitHub et GitLab");
    expect(providerNames([])).toBe("");
  });
});
