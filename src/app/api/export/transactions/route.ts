import { serveCsvExport } from "@/lib/export-route";

/**
 * CSV export of the transactions (`?entity=transactions` on the umbrella route).
 *
 * The filters, the columns, the owner scoping, the row bound and the audit entry all
 * live in `lib/exports.ts` and `lib/export-route.ts`, shared with `/api/export`. This
 * handler only names the entity, so the two entry points cannot drift.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return serveCsvExport(request, "transactions");
}
