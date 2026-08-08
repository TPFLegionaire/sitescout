# SiteScout

SiteScout is an open-source, multi-site website quality operations tool. It combines a bounded read-only audit runner, canonical finding registers, private staff screenshot reports, human validation, reporter feedback, role-based workflows and immutable production/staging baselines.

The repository contains synthetic demonstration data only. The two sample websites use the reserved `example.com` and `example.org` domains; no customer audit, screenshot, email address or credential is bundled.

## What it provides

- An organisation-level portfolio with separate website registers and production/staging targets.
- Passive HTTP checks for status, redirects, metadata, basic accessibility signals and security headers.
- A canonical finding register with plain-language security, customer and reputation impact guidance.
- A separate human-report queue with screenshot paste, crop, blur, solid redaction and private storage.
- Reporter conversations, requests for more information, notifications and a fix/re-test/closure workflow.
- Reporter, Validator, Finding Owner, Administrator and read-only Management Viewer roles.
- Human-approved duplicate suggestions and grouped automated review.
- Versioned baselines, attributable decisions, activity history, privacy controls and pilot metrics.

SiteScout is deliberately not a penetration-testing tool. The audit runner permits only `GET` and `HEAD`, exact configured HTTPS hosts and path prefixes, bounded redirects, bounded concurrency and public IP destinations. Use it only on websites you own or are authorised to assess.

## Run locally

Prerequisites: Node.js 22.13 or newer and npm.

```powershell
npm.cmd install
npm.cmd run dev
```

Open:

- Control room: `http://localhost:3000/`
- Staff reporter: `http://localhost:3000/report`
- Reporter status: `http://localhost:3000/my-reports`
- Readiness: `http://localhost:3000/api/health`

Development mode creates an explicitly local Administrator session. Production has no such fallback and fails closed unless Cloudflare Access is configured or the optional read-only demonstration mode is deliberately enabled.

## Demonstration portfolio

The bundled seed creates:

- one synthetic organisation;
- two independent websites;
- four production/staging targets;
- eight canonical findings;
- synthetic runs, baselines and observations.

Choose a website from the control-room selector. Staff reporting offers every configured website/environment target and duplicate suggestions stay within that website.

## Run a bounded audit

Targets and limits live in `config/audit-targets.json`. The bundled targets are synthetic examples and the CLI refuses to scan them. Replace them with a site you are authorised to assess and record `authorization.status` as `approved` with an accountable owner.

```powershell
npm.cmd run audit:smoke -- --target your-site-staging
npm.cmd run audit:full -- --target your-site-staging
```

Audit JSON is written to the ignored `artifacts/audits/` directory. Review the run and its limitations before importing it through **Runs & baselines**. A run with no completed pages is an execution failure, not evidence about the target.

## Validate a change

```powershell
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run lint
```

For a disposable local D1/R2 integration test:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run-disposable-live-test.ps1
```

The wrapper creates isolated temporary state, exercises the role and reporting workflows, then deletes only the verified temporary directory.

## Deploy privately

The supported independent deployment is a Cloudflare Worker custom domain protected by Cloudflare Access, with D1 for records and private R2 for evidence. Copy `wrangler.sitescout.example.jsonc` to the ignored `wrangler.sitescout.jsonc`, replace its placeholders and follow `docs/cloudflare-independent-deployment.md`.

Do not commit completed Wrangler files, allowlists, Access audience values, API keys, real screenshots or exported customer audit records.

## Documentation

- `docs/architecture.md` — data and trust boundaries.
- `docs/responsible-use.md` — authorised passive-audit policy.
- `docs/privacy-operations.md` — screenshot retention and incident gates.
- `docs/seo-snapshot-pilot.md` — DataForSEO access, profile, cost and evidence controls.
- `docs/site-scout-staff-reporting-plan.md` — operating workflow and deferred recognition.
- `docs/cloudflare-independent-deployment.md` — secure deployment sequence.
- `SECURITY.md` — vulnerability reporting and supported security boundary.
- `CONTRIBUTING.md` — contribution and test requirements.

## Licence

Apache License 2.0. See `LICENSE` and `NOTICE`.
