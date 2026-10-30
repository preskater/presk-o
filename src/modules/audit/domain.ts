/**
 * Audit trail vocabulary (SO-02 / M18-02).
 *
 * The trail answers "who did what, and did it work" for actions that are expensive to
 * reconstruct after the fact: exports today, the rest of the catalogue as it lands.
 * It is deliberately poor in data — a code, an identifier, a count, a calendar day —
 * because an audit log that copies the ledger becomes a second copy of personal data
 * with a different lifetime.
 *
 * Action codes are stable text stored as-is, like module keys: adding one needs no
 * migration. Renaming one would break the history, so add a new code instead.
 */

export const AUDIT_ACTIONS = [
  "export.transactions",
  "export.properties",
  "export.budgets",
  "export.goals",
  "export.alerts",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * How the attempt ended.
 *
 * The export path records `SUCCESS` only: a refused export reads nothing, and recording
 * every malformed link would let a client fill the trail. `REFUSED` and `FAILED` are
 * there for writers that do change data and must say that they did not.
 */
export const AUDIT_OUTCOMES = ["SUCCESS", "REFUSED", "FAILED"] as const;

export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** What is written when a value could not be stored as-is (see `redactAuditMetadata`). */
export const REDACTED_METADATA_VALUE = "[redacted]";

export type AuditMetadata = Record<string, string | number | boolean>;

/**
 * Keys that would turn the trail into a copy of the data it describes.
 *
 * They are dropped, not masked: keeping the key with a placeholder still tells a reader
 * that `amount` or `email` was involved, and that is already more than the trail needs.
 */
const SENSITIVE_KEY =
  /(token|secret|password|hash|credential|cookie|session|email|label|note|address|amount|balance|reason|payload|content|query|search)/i;

/** A key we accept: short, ASCII, no punctuation. */
const SAFE_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

/**
 * A value we accept as-is: a code, a month or calendar day, an identifier. Anything
 * with a space, a comma or a quote is free text read from the ledger — it is redacted
 * rather than truncated, because half a label is still a label.
 */
const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,63}$/;

/**
 * Keeps only what the trail is allowed to store.
 *
 * - a key matching `SENSITIVE_KEY`, or not looking like a code, is dropped altogether;
 * - a boolean or a finite number is kept (counts, `truncated`); an amount is caught by
 *   its key, never by its type;
 * - a string is kept only when it looks like a code, otherwise it becomes
 *   `[redacted]`;
 * - anything else (`null`, a nested object, an array) is dropped: the column is a flat
 *   map of codes, not a payload.
 */
export function redactAuditMetadata(
  metadata: Record<string, unknown> | undefined = {},
): AuditMetadata {
  const safe: AuditMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_KEY.test(key) || SENSITIVE_KEY.test(key)) {
      continue;
    }

    if (typeof value === "boolean") {
      safe[key] = value;
    } else if (typeof value === "number") {
      if (Number.isFinite(value)) {
        safe[key] = value;
      }
    } else if (typeof value === "string") {
      safe[key] = SAFE_VALUE.test(value) ? value : REDACTED_METADATA_VALUE;
    }
  }

  return safe;
}
