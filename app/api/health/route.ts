import { databaseReadiness } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const database = await databaseReadiness();
    const healthy = database.schemaVersion === "7" && database.counts.organizations >= 1 && database.counts.sites >= 1 && database.counts.targets >= 1 && database.counts.findings >= 0 && database.counts.runs >= 0 && database.counts.observations >= 0 && database.counts.baselines >= 0 && database.counts.staffReports >= 0 && database.counts.notifications >= 0 && database.counts.reportMessages >= 0 && database.counts.pilotEvents >= 0;
    return Response.json({ ok: healthy, service: "sitescout", database }, { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Quality platform readiness failed", error);
    return Response.json({ ok: false, service: "sitescout", error: "Readiness check failed." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
