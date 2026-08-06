import { canQuality, requireQualityUser } from "@/app/auth";
import { MyReports } from "@/app/components/MyReports";
import { getMyReportsData } from "@/lib/platform/staff-data";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MyReportsPage() {
  const user = await requireQualityUser("/my-reports");
  if (!canQuality(user.role, "submit_report")) redirect("/");
  return <MyReports user={user} initialData={await getMyReportsData(user)} />;
}
