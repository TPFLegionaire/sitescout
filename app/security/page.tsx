import { redirect } from "next/navigation";
import { canQuality, requireQualityUser } from "@/app/auth";
import { ensureDatabase } from "@/db/bootstrap";
import { recordQualityUser } from "@/lib/platform/staff-data";
import { loadSecurityReview } from "@/lib/platform/security/security-data";
import { SecurityReview } from "@/app/components/SecurityReview";

export const dynamic = "force-dynamic";

export default async function SecurityReviewPage() {
  const user = await requireQualityUser("/security");
  if (user.identitySource === "public-preview" || !canQuality(user.role, "review_security")) redirect("/access-denied?return_to=%2Fsecurity");
  await ensureDatabase();
  await recordQualityUser(user);
  const initial = await loadSecurityReview(user);
  return <SecurityReview user={user} initial={initial} />;
}
