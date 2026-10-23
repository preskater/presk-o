import Link from "next/link";
import { thClass } from "@/components/ui";
import { sortHref, type TableSort } from "@/lib/table-sort";
import type { SearchParamsInput } from "@/lib/search-params";

/**
 * A column header that sorts its table through the URL (see `lib/table-sort`).
 *
 * A plain link: it works without JavaScript, keeps the scroll position on a client
 * navigation, and `aria-sort` tells assistive technology which column is active.
 */
export function SortableHeader<TKey extends string>({
  label,
  column,
  sort,
  param,
  params,
  pathname,
}: {
  label: string;
  column: TKey;
  sort: TableSort<TKey>;
  /** URL parameter holding this table's sort. */
  param: string;
  params: SearchParamsInput;
  pathname: string;
}) {
  const active = sort.key === column;
  const arrow = active ? (sort.direction === "asc" ? "▲" : "▼") : "↕";

  return (
    <th
      scope="col"
      className={thClass}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <Link
        href={sortHref(pathname, params, param, sort, column)}
        scroll={false}
        className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
      >
        {label}
        <span aria-hidden="true" className={active ? "" : "text-zinc-400"}>
          {arrow}
        </span>
      </Link>
    </th>
  );
}
