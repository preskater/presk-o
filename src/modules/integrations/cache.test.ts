import { describe, expect, it } from "vitest";
import {
  CACHE_MAX_AGE_DAYS,
  cacheResourceKey,
  conditionalHeaders,
  isCacheEntryExpired,
  isValidEtag,
  isValidLastModified,
  readValidator,
  usableValidators,
  type CacheEntryLike,
} from "./cache";

const NOW = new Date("2026-10-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY);

function entry(overrides: Partial<CacheEntryLike> = {}): CacheEntryLike {
  return {
    resource: overrides.resource ?? "v1 https://api.example.test/repos/acme/app/issues",
    etag: overrides.etag === undefined ? '"abc"' : overrides.etag,
    lastModified: overrides.lastModified ?? null,
    checkedAt: overrides.checkedAt ?? NOW,
    changedAt: overrides.changedAt ?? daysAgo(1),
  };
}

describe("cacheResourceKey", () => {
  it("prefixes the exact URL with the cache version", () => {
    expect(cacheResourceKey("https://api.example.test/x?per_page=50")).toBe(
      "v1 https://api.example.test/x?per_page=50",
    );
  });

  it("changes with the fetch bounds", () => {
    expect(cacheResourceKey("https://api.example.test/x?per_page=50")).not.toBe(
      cacheResourceKey("https://api.example.test/x?per_page=20"),
    );
  });
});

describe("validator checks", () => {
  it("accepts strong and weak entity tags only when quoted", () => {
    expect(isValidEtag('"abc"')).toBe(true);
    expect(isValidEtag('W/"abc"')).toBe(true);
    expect(isValidEtag("abc")).toBe(false);
    expect(isValidEtag('"a"b"')).toBe(false);
    expect(isValidEtag(`"${"a".repeat(600)}"`)).toBe(false);
  });

  it("accepts only a readable Last-Modified date", () => {
    expect(isValidLastModified("Wed, 30 Sep 2026 10:00:00 GMT")).toBe(true);
    expect(isValidLastModified("pas une date")).toBe(false);
  });

  it("reads validators from headers and ignores malformed ones", () => {
    expect(readValidator(new Headers({ etag: '"v"' }))).toEqual({ etag: '"v"', lastModified: null });
    expect(readValidator(new Headers({ etag: "v", "last-modified": "?" }))).toBeNull();
    expect(readValidator(new Headers())).toBeNull();
  });

  it("turns a validator into conditional headers", () => {
    expect(conditionalHeaders({ etag: '"v"', lastModified: null })).toEqual({ "If-None-Match": '"v"' });
    expect(conditionalHeaders(null)).toEqual({});
  });
});

describe("expiry", () => {
  it(`expires an entry whose rows were written more than ${CACHE_MAX_AGE_DAYS} days ago`, () => {
    expect(isCacheEntryExpired({ changedAt: daysAgo(CACHE_MAX_AGE_DAYS) }, NOW)).toBe(false);
    expect(isCacheEntryExpired({ changedAt: new Date(daysAgo(CACHE_MAX_AGE_DAYS).getTime() - 1) }, NOW)).toBe(true);
  });
});

describe("usableValidators", () => {
  it("keeps fresh, well-formed validators by resource", () => {
    expect(usableValidators([entry()], NOW)).toEqual(
      new Map([["v1 https://api.example.test/repos/acme/app/issues", { etag: '"abc"', lastModified: null }]]),
    );
  });

  it("drops expired entries even when the provider would still answer 304", () => {
    expect(usableValidators([entry({ changedAt: daysAgo(30) })], NOW).size).toBe(0);
  });

  it("drops invalid stored metadata instead of sending it", () => {
    expect(usableValidators([entry({ etag: "broken", lastModified: "never" })], NOW).size).toBe(0);
    expect(usableValidators([entry({ etag: null, lastModified: null })], NOW).size).toBe(0);
  });

  it("keeps the valid half of a partly invalid entry", () => {
    const usable = usableValidators(
      [entry({ etag: "broken", lastModified: "Wed, 30 Sep 2026 10:00:00 GMT" })],
      NOW,
    );

    expect([...usable.values()]).toEqual([{ etag: null, lastModified: "Wed, 30 Sep 2026 10:00:00 GMT" }]);
  });
});
