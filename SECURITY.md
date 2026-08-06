# Security policy

## Supported versions

Security fixes are applied to the current default branch. Operators are responsible for keeping dependencies, Cloudflare settings and deployment secrets current.

## Reporting a vulnerability

Do not open a public issue containing an exploit, credential, private URL, screenshot or personal data. Use the repository host's private security-advisory feature and include the affected version, impact, minimal reproduction and suggested mitigation. Maintainers should acknowledge a complete report within five working days.

## Security boundary

- Production authentication must use `QUALITY_AUTH_MODE=cloudflare-access` with a verified Access issuer and audience.
- Missing or invalid Access tokens fail closed before application routes run.
- D1 and R2 must remain private; evidence responses use private, no-store caching.
- Staff screenshots must not contain credentials, tokens, customer data or unrelated personal information.
- Automated audits are passive and bounded. Active scanning, exploitation, credential testing and denial-of-service testing are out of scope.
- AI assistance is text-only, optional and advisory. Screenshots are never sent to the AI service and humans retain every decision.

The software does not certify security, accessibility, legal compliance or absence of defects.
