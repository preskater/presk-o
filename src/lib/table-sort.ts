import { readSearchParam, type SearchParamsInput } from "./search-params";

/**
 * Column sorting kept in the URL, like the explorer filters: a sorted view is
 * shareable, survives a reload and needs no client-side state. The value reads
 * `<column>.<direction>`, for example `?queueSort=age.desc`.
 */
export type SortDirection = "asc" | "desc";

export type TableSort<TKey extends string> = { key: TKey; direction: SortDirection };

/** The requested sort, or `fallback` when the parameter is absent or names nothing known. */
export function readTableSort<TKey extends string>(
  params: SearchParamsInput,
  param: string,
  keys: readonly TKey[],
  fallback: TableSort<TKey>,
): TableSort<TKey> {
  const [key, direction] = (readSearchParam(params, param) ?? "").split(".");
  const knownKey = keys.find((candidate) => candidate === key);

  if (!knownKey || (direction !== "asc" && direction !== "desc")) {
    return fallback;
  }

  return { key: knownKey, direction };
}

/**
 * The link a column header points to: the same column flips its direction, another
 * column starts ascending. Every other parameter (filters, focused repository) is kept.
 */
export function sortHref<TKey extends string>(
  pathname: string,
  params: SearchParamsInput,
  param: string,
  current: TableSort<TKey>,
  key: TKey,
): string {
  const query = new URLSearchParams();

  for (const [name, value] of Object.entries(params)) {
    if (name !== param && typeof value === "string" && value !== "") {
      query.set(name, value);
    }
  }

  const direction = current.key === key && current.direction === "asc" ? "desc" : "asc";
  query.set(param, `${key}.${direction}`);

  return `${pathname}?${query.toString()}`;
}

/** `1` or `-1` applied to an ascending comparison. */
export function directionFactor(direction: SortDirection): 1 | -1 {
  return direction === "asc" ? 1 : -1;
}
