import { requireQualityCapability } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { apiError } from "@/lib/platform/validation";

export async function POST(request: Request) {
  try {
    const user = await requireQualityCapability("submit_report");
    await ensureDatabase();
    const body = await request.json().catch(() => ({})) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && id.length <= 100).slice(0, 100) : [];
    const now = new Date().toISOString();
    if (ids.length) {
      await getD1().batch(ids.map((id) => getD1().prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND LOWER(recipient_email) = LOWER(?)").bind(now, id, user.email)));
    } else {
      await getD1().prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE LOWER(recipient_email) = LOWER(?)").bind(now, user.email).run();
    }
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
