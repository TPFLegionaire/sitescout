import { env } from "cloudflare:workers";
import { requireQualityRole } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";
import { apiError } from "@/lib/platform/validation";
import { purgeExpiredSecurityArtifacts } from "@/lib/platform/security/security-retention";

export async function POST() {
  try {
    const user = await requireQualityRole("administrator");
    await ensureDatabase();
    if (!env.EVIDENCE) throw Object.assign(new Error("Restricted artifact storage is unavailable."), { status: 503 });
    const result = await purgeExpiredSecurityArtifacts(getD1(), env.EVIDENCE, { actor: user.email, limit: 100 });
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
