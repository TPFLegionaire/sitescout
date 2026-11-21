# Architecture and trust boundaries

## Data hierarchy

An organisation contains sites. Each site owns its production/staging targets, canonical findings and environment states. Audit runs, baselines and observations point to exact targets, preventing a duplicate suggestion or review action from crossing website boundaries.

## Runtime

The application is a Next-compatible React application compiled for Cloudflare Workers. D1 stores structured records. R2 stores private evidence objects. The Worker validates Cloudflare Access identity before forwarding trusted identity headers to application routes.

## Trust boundaries

- Browser input, imported audits and target content are untrusted.
- URLs are checked against an exact target host and path prefix.
- Audit redirects and DNS answers are revalidated; private and reserved IP ranges are rejected.
- The allowlist check and the subsequent fetch resolve DNS independently, so an authoritative server alternating its answers (DNS rebinding) is a residual risk accepted for operator-configured targets.
- Mutation permissions are enforced on the server, not only hidden in the interface.
- Finding linkage is constrained to the observation target's site.
- Screenshots are private, size-limited and served without public caching.
- Optional AI receives report text only and cannot accept findings, award recognition or publish tickets.

## Deployment separation

The open-source repository contains synthetic seed data. Operators keep customer configuration, real audit records, screenshots, role allowlists and infrastructure identifiers in a separate private deployment repository or secret-management system.
