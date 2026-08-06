import { requireQualityUser } from "./auth";
import { getDashboardData } from "@/lib/platform/data";
import { QualityPlatform } from "./components/QualityPlatform";
import { redirect } from "next/navigation";
import { recordQualityUser } from "@/lib/platform/staff-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireQualityUser("/");
  if (user.role !== "management_viewer") await recordQualityUser(user);
  if (user.role === "reporter") redirect("/report");
  const data = await getDashboardData(user);
  return <QualityPlatform initialData={data} user={user} />;
}
