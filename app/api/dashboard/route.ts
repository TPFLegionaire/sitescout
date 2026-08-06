import { requireQualityCapability } from "@/app/auth";
import { getDashboardData } from "@/lib/platform/data";
import { apiError } from "@/lib/platform/validation";
import { recordQualityUser } from "@/lib/platform/staff-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireQualityCapability("view_operator");
    if (user.role !== "management_viewer") await recordQualityUser(user);
    return Response.json({ ok: true, user, data: await getDashboardData(user) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
