import { redirect } from "next/navigation";
import { requireQualityUser } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { recordQualityUser } from "@/lib/platform/staff-data";
import { listSeoSites, loadSeoSnapshotsForSite } from "@/lib/platform/seo/seo-data";
import { SeoSnapshots } from "@/app/components/SeoSnapshots";

export const dynamic = "force-dynamic";

export default async function SeoSnapshotPage() {
  const user = await requireQualityUser("/seo");
  if (user.role === "reporter") redirect("/report");
  if (user.role !== "management_viewer") await recordQualityUser(user);
  await ensureDatabase();

  const sites = await listSeoSites();
  const selectedSiteId = sites[0]?.siteId ?? "";
  const initial = selectedSiteId
    ? await loadSeoSnapshotsForSite(selectedSiteId)
    : { snapshots: [], metrics: [], budget: { month: "", monthlySpentUsd: 0, monthlyCapUsd: 0, perOperationCapUsd: 0 } };

  return <SeoSnapshots user={user} sites={sites} selectedSiteId={selectedSiteId} initial={initial} />;
}
