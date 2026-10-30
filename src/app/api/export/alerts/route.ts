import { serveCsvExport } from "@/lib/export-route";

/**
 * CSV export of the alerts (`?entity=alerts` on the umbrella route).
 *
 * Status and trigger-date filters, the module visibility rule and the recomputed reason
 * live in the shared builder (`lib/exports.ts`).
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return serveCsvExport(request, "alerts");
}
