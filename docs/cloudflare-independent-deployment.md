# Private Cloudflare deployment

This is the supported production architecture:

- a Cloudflare Worker custom domain;
- Cloudflare Access in front of every application route;
- independent verification of the signed Access JWT in the Worker;
- D1 for application records;
- private R2 for screenshots and imported audit files;
- exact server-side role allowlists for the initial pilot.

## Account preparation

1. Add the deployment domain to Cloudflare and wait until the zone is active.
2. Create a Zero Trust organisation and select an approved identity method.
3. Create a self-hosted Access application for the intended hostname.
   - In its cookie settings, set SameSite to `Lax` or `Strict` and enable HttpOnly.
4. Add exact pilot email addresses or an approved identity group. Do not use an unrestricted Everyone policy.
5. Record the Zero Trust team domain and the application's Audience tag.
6. Create a D1 database and a private R2 bucket.
7. Copy `wrangler.sitescout.example.jsonc` to `wrangler.sitescout.jsonc`.
8. Replace the hostname, D1 ID, bucket name, team domain and Audience placeholder.
9. Configure role allowlists as protected Worker values or secrets:
   - `QUALITY_MANAGEMENT_VIEWER_EMAILS`
   - `QUALITY_ADMIN_EMAILS`
   - `QUALITY_VALIDATOR_EMAILS`
   - `QUALITY_FINDING_OWNER_EMAILS`
   - `QUALITY_SECURITY_REVIEWER_EMAILS`
   - `QUALITY_REPORTER_EMAILS`
10. Keep `QUALITY_SECURITY_IMPORT_TARGET_IDS` empty unless an exact disposable target has been approved for externally run Strix evaluation. Set `QUALITY_SECURITY_ARTIFACT_RETENTION_DAYS` and retain the daily cron trigger.
11. Add exact non-administrator site assignments in `quality_user_roles`; an allowlist entry alone does not grant site access.
12. Keep `QUALITY_PUBLIC_DEMO=false` and AI assistance disabled for the first release.

Do not manually create the application-hostname DNS record when using a Worker custom domain; deployment manages the record and certificate.

## Build and deploy

```powershell
$env:CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH="wrangler.sitescout.jsonc"
npm.cmd run build
npx.cmd wrangler deploy --config dist/server/wrangler.json
```

Apply the SQL migrations from `drizzle/` to the production D1 database using the deployment process approved for your account. The application bootstrap is additive, but migrations and backups should still be treated as controlled changes.

## Release checks

1. Sign in with the Administrator account.
2. Open `/api/health` through an authenticated browser session.
3. Confirm the intended organisation, websites and targets before importing real audits.
4. Test one exact account for every role.
5. Confirm an unknown account is denied.
6. Confirm Reporters cannot access operator routes and can see only their own evidence.
7. Confirm R2 objects are not public and evidence responses are `private, no-store`.
8. Submit, request information on, reply to, assign, fix, re-test and close one disposable report.
9. Import one synthetic Strix report for an approved disposable target; prove a Security Reviewer without a matching site assignment sees no targets.
10. Prove high/critical review needs a second person, raw-artifact reads are logged, a legal hold blocks deletion and the retention endpoint removes only expired non-held objects.
11. Verify application logs contain no screenshots, raw exploit material, credentials, private storage keys or Access tokens.
12. Confirm the `CF_Authorization` cookie is `SameSite=Lax` or `Strict` and `HttpOnly`.
13. Open every page with the browser console visible and confirm it reports no `Content-Security-Policy-Report-Only` violations. Record any violation before the policy is enforced.

## Rollback and recovery

Rollback the Worker version or remove the custom-domain route if validation fails. Do not delete D1 or R2 as part of an application rollback. Use D1 recovery/backup controls and an approved R2 evidence restore process, then document the recovery test.

Keep `/api/health` protected unless a narrowly scoped monitoring design has been reviewed. Do not create a broad Access bypass merely for uptime monitoring.
