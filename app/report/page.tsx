import { canQuality, requireQualityUser } from "@/app/auth";
import { StaffReporter } from "@/app/components/StaffReporter";
import { getStaffReportingData } from "@/lib/platform/staff-data";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ReportPage() {
  const user = await requireQualityUser("/report");
  if (!canQuality(user.role, "submit_report")) redirect("/");
  const data = await getStaffReportingData(user);
  return <StaffReporter user={user} initialData={data} />;
}
