import { serveCsvExport } from "@/lib/export-route";

/** CSV export of the properties, with their totals. Authenticated server-side. */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return serveCsvExport(request, "properties");
}
