import { redirect } from "next/navigation";
import { canQuality, requireQualityUser } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { recordQualityUser } from "@/lib/platform/staff-data";
import { listSeoSites, loadSeoSnapshotsForSite } from "@/lib/platform/seo/seo-data";
import { SeoSnapshots } from "@/app/components/SeoSnapshots";
import { configuredSeoProfile } from "@/lib/platform/seo/dataforseo";

export const dynamic = "force-dynamic";

export default async function SeoSnapshotPage() {
  const user = await requireQualityUser("/seo");
  if (user.identitySource === "public-preview" || !canQuality(user.role, "view_seo")) redirect("/access-denied?return_to=%2Fseo");
  await recordQualityUser(user);
  await ensureDatabase();

  const sites = await listSeoSites(user);
  const selectedSiteId = sites[0]?.siteId ?? "";
  const initial = selectedSiteId
    ? await loadSeoSnapshotsForSite(user, selectedSiteId)
    : { snapshots: [], metrics: [], budget: { month: "", monthlySpentUsd: 0, monthlyCapUsd: 0, perOperationCapUsd: 0 }, profile: configuredSeoProfile() };

  return <SeoSnapshots user={user} sites={sites} selectedSiteId={selectedSiteId} initial={initial} />;
}
