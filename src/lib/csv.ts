/**
 * CSV export helpers.
 *
 * Exports are the only way out of the dashboard, so they must stay readable by
 * a spreadsheet without becoming a security risk: a value starting with `=`,
 * `+`, `-` or `@` is interpreted as a formula by Excel and LibreOffice.
 */

export type CsvColumn<Row> = {
  key: keyof Row & string;
  header: string;
};

/**
 * How many rows one export may contain.
 *
 * The decision is **bound, don't stream**: an export is built in memory from one SQL
 * read, so the read itself carries the limit. At this size the file stays a few
 * megabytes — comfortable for a spreadsheet — and the server never risks building an
 * unbounded string. Every route reads `EXPORT_ROW_LIMIT + 1` rows: the extra one proves
 * the window was cut, so the response can say so (`X-Export-Truncated`) instead of
 * silently delivering a prefix. Past this cap the right answer would be a real streaming
 * writer (cursor + chunked response); until a dataset actually reaches it, that
 * complexity buys nothing.
 */
export const EXPORT_ROW_LIMIT = 10_000;

/** Every export response carries this header, `true` when the row cap cut the file. */
export const EXPORT_TRUNCATED_HEADER = "X-Export-Truncated";

const FORMULA_TRIGGERS = ["=", "+", "@", "\t", "\r"];

function looksLikeNumber(value: string): boolean {
  return /^-?\d+([.,]\d+)?$/.test(value);
}

/**
 * Normalises a value and defuses spreadsheet formula injection.
 *
 * Numeric strings are left untouched, otherwise a negative amount such as
 * `-45,90` would be neutralised. Other values that begin with a formula trigger
 * are prefixed with an apostrophe.
 */
export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = value instanceof Date ? value.toISOString() : String(value);

  const guarded =
    !looksLikeNumber(text) && FORMULA_TRIGGERS.some((trigger) => text.startsWith(trigger))
      ? `'${text}`
      : text;

  const mustQuote = /[",;\n\r]/.test(guarded) || guarded !== guarded.trim();

  return mustQuote ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv<Row extends Record<string, unknown>>(
  rows: readonly Row[],
  columns: readonly CsvColumn<Row>[],
): string {
  const header = columns.map((column) => escapeCsvValue(column.header)).join(",");
  const lines = rows.map((row) =>
    columns.map((column) => escapeCsvValue(row[column.key])).join(","),
  );

  return [header, ...lines].join("\r\n");
}

/**
 * Builds a downloadable CSV response.
 *
 * The UTF-8 BOM keeps accents readable when the file is opened directly in
 * Excel; bank and spreadsheet tools that dislike it can strip it.
 *
 * `truncated` is stated rather than implied: a spreadsheet cannot tell a complete file
 * from a capped one, so the header is the only place the cut is visible.
 */
export function createCsvResponse(
  csv: string,
  fileName: string,
  options: { truncated?: boolean } = {},
): Response {
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      // Personal financial data: never cache an export in a shared proxy.
      "Cache-Control": "no-store",
      [EXPORT_TRUNCATED_HEADER]: options.truncated ? "true" : "false",
    },
  });
}
