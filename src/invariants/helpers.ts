import Decimal from "decimal.js";

/**
 * Shared tools of the invariant suite (UX-04). Test-only: nothing in the application
 * imports this file.
 */

/**
 * Deterministic pseudo-random generator (mulberry32). Property tests draw their cases
 * from a fixed seed, so a failure always replays identically: no flaky run, no network,
 * no dependency.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max], both included. */
export function randomInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/**
 * Paths of every value that cannot cross the server → client boundary as is: a
 * `Decimal`, a `Date`, a function, a class instance, `undefined` inside an array, a
 * non-finite number. Empty means the value is plain data.
 */
export function nonPlainPaths(value: unknown, path = "$"): string[] {
  if (value === null || typeof value === "string" || typeof value === "boolean") return [];
  if (typeof value === "number") return Number.isFinite(value) ? [] : [path];
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      item === undefined ? [`${path}[${index}]`] : nonPlainPaths(item, `${path}[${index}]`),
    );
  }
  if (typeof value === "object") {
    if (value instanceof Decimal || value instanceof Date) return [path];
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return [path];
    return Object.entries(value).flatMap(([key, item]) => nonPlainPaths(item, `${path}.${key}`));
  }
  return [path];
}
