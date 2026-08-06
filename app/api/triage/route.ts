import { requireQualityCapability } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { apiError, assertTargetUrl, optionalText, requiredText } from "@/lib/platform/validation";
import { getTriageCandidates, recordQualityUser } from "@/lib/platform/staff-data";
import { createTriageDraft } from "@/lib/platform/triage";

export async function POST(request: Request) {
  try {
    const user = await requireQualityCapability("submit_report");
    await ensureDatabase();
    await recordQualityUser(user);
    const body = await request.json() as Record<string, unknown>;
    const targetId = requiredText(body.targetId, "Environment", 100);
    const description = requiredText(body.description, "What happened", 4000);
    const target = await getD1().prepare("SELECT site_id AS siteId, allowed_host AS allowedHost, allowed_path_prefix AS allowedPathPrefix FROM targets WHERE id = ? AND active = 1").bind(targetId).first<{ siteId: string; allowedHost: string; allowedPathPrefix: string }>();
    if (!target) return Response.json({ ok: false, error: "Target not found" }, { status: 404 });
    const url = assertTargetUrl(body.url, target);
    const draft = await createTriageDraft({
      url,
      description,
      title: optionalText(body.title, 240) ?? undefined,
      expected: optionalText(body.expected, 2000) ?? undefined,
      actual: optionalText(body.actual, 2000) ?? undefined,
    }, await getTriageCandidates(target.siteId));
    return Response.json({ ok: true, draft }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
