# Strix import-only security evaluation

This pilot accepts completed Strix JSON or SARIF 2.1.0 reports as **untrusted evidence for human review**. SiteScout does not install, launch, schedule or control Strix and does not perform active security scanning. Run any external assessment only under separate written authorisation and safety controls.

## Trust boundary

- `source` is fixed by the server to `strix`; browser input cannot select another provider.
- Every upload is bound to one active registered target whose ID is also present in `QUALITY_SECURITY_IMPORT_TARGET_IDS`.
- The deployment allowlist should contain disposable evaluation targets only. An empty allowlist disables imports.
- A Security Reviewer needs both the `QUALITY_SECURITY_REVIEWER_EMAILS` allowlist entry and an active `quality_user_roles` row for the exact organisation/site. Administrators are global.
- Imported candidates never create or modify canonical findings, observations, tickets, baselines or audit runs.
- Raw reports remain in private R2. The normal review API returns only sanitised candidate fields and never returns the R2 key.

## Configure a reviewer and target

Add the reviewer email to `QUALITY_SECURITY_REVIEWER_EMAILS`. Then create an exact site assignment in D1 (replace every example value):

```sql
INSERT INTO quality_user_roles
  (id, email, organization_id, site_id, role, active, created_at, updated_at)
VALUES
  ('security-reviewer-example-site', 'reviewer@example.test', 'example-organization', 'example-site',
   'security_reviewer', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
```

Set the registered target ID, not a URL:

```text
QUALITY_SECURITY_IMPORT_TARGET_IDS=example-disposable-staging
QUALITY_SECURITY_ARTIFACT_RETENTION_DAYS=30
```

The target must already exist in `targets`, be active, belong to the assigned site and define the exact allowed host and path prefix. Restart or redeploy after changing Worker configuration.

## Import and review

1. Run Strix outside SiteScout against the separately authorised disposable target.
2. Sign in as an assigned Security Reviewer or Administrator and open `/security`.
3. Select the approved target and upload the completed JSON or SARIF file.
4. Review the sanitised candidate. Query strings, fragments, credentials, secret-like values, raw HTTP traffic, exploit payloads, out-of-scope endpoints and known raw request/response fields are removed, redacted or quarantined.
5. Open the access-logged raw artifact only when the sanitised record is insufficient and your operational policy permits it.
6. Record a human decision. Every high, critical or unknown-severity candidate requires a second decision from a different reviewer. Review history is append-only and final states are immutable through the API.
7. Create or link a canonical finding only through the normal SiteScout human workflow after validation; the pilot does not do this automatically.

Duplicate uploads are idempotent per organisation, site, target and SHA-256 digest. Limits are 10 MiB, 75 candidates, 25 SARIF runs, 50,000 JSON nodes, nesting depth 20 and 250,000 characters of sanitised candidate text.

## Raw-artifact retention and deletion

Raw artifacts default to 30 days and may be configured from one to 365 days. The Worker cron runs daily and deletes expired, non-held R2 objects. An Administrator can also invoke `POST /api/security/artifacts/retention`; manual deletion of one import uses `DELETE /api/security/artifacts/{importRunId}`. Successful reads and deletions create attributable activity events.

Set `legal_hold=1` through the controlled D1 operations process **before** the retention deadline when preservation is required. Legal hold blocks automatic and manual deletion. Sanitised candidates and append-only review history remain after the raw artifact is deleted. R2 versioning, backups and external exports need separate retention controls; this application cannot delete copies held outside its configured primary bucket.

## Evaluation decision

The scorecard reports imports, empty/incomplete reports, candidate severity and status, final decision rates, duplicate and false-positive rates, unsafe-evidence classifications, timed review burden and outstanding first/second checks. Treat an empty report as unproven coverage, never as evidence that a target is secure.

Stop the pilot if target scope cannot be proven, raw evidence cannot remain private, reviewer separation cannot be maintained, or the operational value does not justify the review burden.
