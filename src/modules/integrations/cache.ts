/**
 * Conditional provider requests (DA-04).
 *
 * A provider answers `304 Not Modified` when a resource still matches the validator
 * it returned last time (`ETag` → `If-None-Match`, `Last-Modified` →
 * `If-Modified-Since`). The stored snapshot rows of that resource are then current
 * and are not rewritten; only the check is recorded.
 *
 * The rule that matters: a validator may only be sent when the rows it vouches for
 * are known to be in the database exactly as that response wrote them. Everything
 * here errs towards a full read — an unusable, malformed or expired validator is
 * simply not sent, and the provider answers in full.
 */

/**
 * Part of every resource key. Bump it when the normalisation or the stored fields
 * change: every existing validator then stops matching and the next run reads in full.
 */
export const CACHE_VERSION = "v1";

/**
 * A validator is not sent once its resource was last written this long ago, so every
 * resource is read in full at least once a week whatever the provider says.
 */
export const CACHE_MAX_AGE_DAYS = 7;

const MAX_ETAG_LENGTH = 512;
const MAX_LAST_MODIFIED_LENGTH = 64;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export type CacheValidator = {
  etag: string | null;
  lastModified: string | null;
};

export type CacheEntryLike = CacheValidator & {
  resource: string;
  /** Last successful check, 200 or 304. */
  checkedAt: Date;
  /** Last time the resource's rows were written from a full (200) answer. */
  changedAt: Date;
};

/**
 * The key a validator is stored under: the version and the exact request URL. The URL
 * carries the repository, the instance and the fetch bounds (`per_page`, filters), so
 * changing a bound changes the key and the old validator is never reused for it.
 * The token is never part of a URL here.
 */
export function cacheResourceKey(url: string): string {
  return `${CACHE_VERSION} ${url}`;
}

/** A strong or weak entity tag, quoted, printable, of reasonable length. */
export function isValidEtag(value: string): boolean {
  return value.length <= MAX_ETAG_LENGTH && /^(W\/)?"[\x21\x23-\x7e]*"$/.test(value);
}

export function isValidLastModified(value: string): boolean {
  return value.length <= MAX_LAST_MODIFIED_LENGTH && !Number.isNaN(Date.parse(value));
}

/** The validators of a 200 answer, or `null` when it carried no usable one. */
export function readValidator(headers: Headers): CacheValidator | null {
  const etag = headers.get("etag");
  const lastModified = headers.get("last-modified");
  const validator = {
    etag: etag && isValidEtag(etag) ? etag : null,
    lastModified: lastModified && isValidLastModified(lastModified) ? lastModified : null,
  };

  return validator.etag || validator.lastModified ? validator : null;
}

/** Expired once its rows were last written more than `CACHE_MAX_AGE_DAYS` ago. */
export function isCacheEntryExpired(
  entry: Pick<CacheEntryLike, "changedAt">,
  now: Date,
): boolean {
  return now.getTime() - entry.changedAt.getTime() > CACHE_MAX_AGE_DAYS * MILLISECONDS_PER_DAY;
}

/**
 * The validators worth sending this run, by resource key: neither expired nor
 * malformed. Stored metadata that fails either test is ignored, never trusted.
 */
export function usableValidators(
  entries: readonly CacheEntryLike[],
  now: Date,
): Map<string, CacheValidator> {
  const usable = new Map<string, CacheValidator>();

  for (const entry of entries) {
    if (isCacheEntryExpired(entry, now)) {
      continue;
    }

    const validator = {
      etag: entry.etag && isValidEtag(entry.etag) ? entry.etag : null,
      lastModified:
        entry.lastModified && isValidLastModified(entry.lastModified)
          ? entry.lastModified
          : null,
    };

    if (validator.etag || validator.lastModified) {
      usable.set(entry.resource, validator);
    }
  }

  return usable;
}

/** The request headers a validator turns into. */
export function conditionalHeaders(validator: CacheValidator | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {};

  if (validator?.etag) {
    headers["If-None-Match"] = validator.etag;
  }
  if (validator?.lastModified) {
    headers["If-Modified-Since"] = validator.lastModified;
  }

  return headers;
}
