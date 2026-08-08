import { env } from "cloudflare:workers";
import { requireQualityCapability } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";

// Raw Strix artifacts are restricted: only a Security Reviewer or Administrator
// (holders of the review_security capability) may fetch them. Everyone else is
// rejected by the capability gate, so management never receives raw exploit
// material, credentials or traffic.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireQualityCapability("review_security");
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: unknown }).status) : 401;
    return new Response(status === 403 ? "Forbidden" : "Authentication required", { status: Number.isFinite(status) ? status : 401 });
  }

  await ensureDatabase();
  const { id } = await context.params;
  const run = await getD1()
    .prepare("SELECT artifact_storage_key AS storageKey FROM security_import_runs WHERE id = ?")
    .bind(id)
    .first<{ storageKey: string | null }>();
  if (!run) return new Response("Not found", { status: 404 });
  if (!run.storageKey || !env.EVIDENCE) return new Response("Artifact unavailable", { status: 503 });

  const object = await env.EVIDENCE.get(run.storageKey);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "private, no-store");
  headers.set("content-type", "application/json");
  headers.set("content-disposition", `attachment; filename="strix-import-${id}.json"`);
  return new Response(object.body, { headers });
}
