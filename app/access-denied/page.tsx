import { getAuthenticatedQualityUser, qualitySignOutPath } from "@/app/auth";

export const dynamic = "force-dynamic";

export default async function AccessDenied() {
  const user = await getAuthenticatedQualityUser();
  return (
    <main className="access-page">
      <section>
        <p className="eyebrow">SITESCOUT PRIVATE PILOT</p>
        <h1>Access has not been assigned.</h1>
        <p>{user?.email ?? "This account"} is signed in, but it is not in the named staff allowlist. Ask the SiteScout administrator to assign an appropriate role.</p>
        <a href={qualitySignOutPath()}>Sign out and use another account</a>
      </section>
    </main>
  );
}
