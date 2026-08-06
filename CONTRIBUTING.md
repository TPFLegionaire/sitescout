# Contributing

Contributions are welcome when they preserve the safety, privacy and human-review boundaries.

1. Open an issue for substantial behaviour or schema changes.
2. Use synthetic fixtures and reserved domains (`example.com`, `example.org`, `.invalid`).
3. Never commit customer names, audit exports, screenshots, email allowlists, credentials or deployment identifiers.
4. Keep automated network activity passive, host-bound and rate-limited.
5. Add or update tests for every behaviour change.
6. Run `npx tsc --noEmit`, `npm test` and `npm run lint` before proposing the change.

Pull requests should explain the user outcome, security/privacy impact, schema or migration impact, tests performed and any rollout or rollback requirement.

By contributing, you agree that your contribution is licensed under Apache-2.0.
