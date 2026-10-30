import { serveCsvExport } from "@/lib/export-route";

/**
 * CSV export of the financial goals (`?entity=goals` on the umbrella route).
 *
 * Status and target-date filters, the progress rules and the "unknown is empty, never
 * zero" convention live in the shared builder (`lib/exports.ts`).
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return serveCsvExport(request, "goals");
}
