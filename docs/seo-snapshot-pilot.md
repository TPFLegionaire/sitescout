# DataForSEO snapshot pilot

This integration captures read-only external SEO evidence. It does not scan a website, create a finding, change a baseline or publish provider output as SiteScout truth.

## Access boundary

- `administrator` is the deployment-wide system role and can capture or view snapshots for every registered site.
- Management viewers, validators and finding owners may view snapshots only when an active `quality_user_roles` row matches their email, role, organisation and exact site (or site `*`).
- Public-preview identities and reporters cannot access SEO snapshots.
- The target domain is derived from an active registered target. A request cannot provide a URL.

Example site-scoped assignment:

```sql
INSERT INTO quality_user_roles (id, email, organization_id, site_id, role, active, created_at, updated_at)
VALUES ('seo-viewer-example', 'viewer@example.com', 'organization-id', 'site-id', 'management_viewer', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
```

## Provider and cost boundary

- The deployment controls one DataForSEO Labs profile through `QUALITY_SEO_COUNTRY`, `QUALITY_SEO_LANGUAGE` and `QUALITY_SEO_LOCATION_CODE`. Browser input cannot change it.
- Labs operations send `target`, `language_code` and `location_code`; backlink summary sends only `target` and is labelled global/all devices.
- Credentials may be sent only to the exact `https://api.dataforseo.com` or `https://sandbox.dataforseo.com` origin. Redirects are refused.
- HTTP success is not enough: top-level status, task status, task error count and echoed Labs scope must all pass validation.
- An atomic D1 reservation enforces one active dispatch and the monthly cap. Active reservations count against the cap.
- A failed canonical request may be retried once. Provider-reported cost is retained even when artifact or database finalisation fails.
- Stale two-minute leases are marked abandoned before a bounded retry.

Raw provider responses remain private R2 evidence under organisation/site-scoped keys. The UI exposes only normalized metrics, limitations, hashes and accountable run metadata.
