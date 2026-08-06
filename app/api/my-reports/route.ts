import { requireQualityCapability } from "@/app/auth";
import { apiError } from "@/lib/platform/validation";
import { getMyReportsData } from "@/lib/platform/staff-data";

export async function GET() {
  try {
    const user = await requireQualityCapability("submit_report");
    return Response.json({ ok: true, data: await getMyReportsData(user) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
