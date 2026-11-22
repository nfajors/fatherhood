import { getDb } from "@/lib/db";
import { organizationReport, progressCsv } from "@/lib/organizations/reports";
import { asOrgManager } from "../../_shared";

export const dynamic = "force-dynamic";

/** CSV of the fathers who share their progress. */
export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  return asOrgManager((await params).orgId, async ({ org }) => {
    const report = (await organizationReport(getDb(), org.id))!;
    return new Response(progressCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${org.slug}-progress-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
