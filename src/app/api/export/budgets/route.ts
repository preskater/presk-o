import { serveCsvExport } from "@/lib/export-route";

/**
 * CSV export of the monthly budgets (`?entity=budgets` on the umbrella route).
 *
 * One month by default (`?month=YYYY-MM`, current month when absent or malformed); a
 * `from`/`to` window selects whole months. The builder is shared with `/api/export`.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return serveCsvExport(request, "budgets");
}
