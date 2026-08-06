import { env } from "cloudflare:workers";
import { requireQualityRole } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getD1 } from "@/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireQualityRole("reporter", "validator", "finding_owner", "administrator"); } catch (error) { const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 401; return Response.json({ ok: false, error: error instanceof Error ? error.message : "Authentication required" }, { status }); }
  await ensureDatabase();
  const { id } = await context.params;
  const asset = await getD1().prepare(`
    SELECT e.storage_key AS storageKey, e.public_url AS publicUrl, e.caption, o.created_by AS createdBy,
           COALESCE(p.classification, 'standard') AS classification, w.assigned_to AS assignedTo
    FROM evidence_assets e
    JOIN observations o ON o.id = e.observation_id
    LEFT JOIN report_privacy p ON p.observation_id = o.id
    LEFT JOIN staff_report_workflow w ON w.observation_id = o.id
    WHERE e.id = ?
  `).bind(id).first<{ storageKey: string | null; publicUrl: string | null; caption: string; createdBy: string; classification: string; assignedTo: string | null }>();
  if (!asset) return new Response("Not found", { status: 404 });
  if (user.role === "reporter" && asset.createdBy.toLowerCase() !== user.email.toLowerCase()) return new Response("Forbidden", { status: 403 });
  if (asset.classification === "restricted_security" && user.role === "finding_owner" && asset.assignedTo?.toLowerCase() !== user.email.toLowerCase()) return new Response("Forbidden", { status: 403 });
  if (asset.publicUrl) return Response.redirect(new URL(asset.publicUrl, _request.url), 302);
  if (!asset.storageKey || !env.EVIDENCE) return new Response("Evidence unavailable", { status: 503 });
  const object = await env.EVIDENCE.get(asset.storageKey);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "private, no-store");
  headers.set("content-disposition", `inline; filename="${asset.caption.replace(/[\r\n"\\]/g, "_")}"`);
  return new Response(object.body, { headers });
}
