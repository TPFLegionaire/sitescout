# Staff reporting operating plan

## Goal

Give staff a private route to capture a website problem quickly while preserving human validation, evidence privacy and an attributable correction history.

`Staff report -> assisted draft -> human validation -> canonical finding -> assignment -> fix -> re-test -> closure`

## Roles

| Role | Core responsibility |
|---|---|
| Reporter | Submit evidence, answer questions and see their own status |
| Validator | Reproduce, request information, accept, link or reject, then re-test |
| Finding Owner | Investigate assigned findings and record a fix |
| Administrator | Manage access, portfolio scope, baselines and privacy operations |
| Management Viewer | Inspect the read-only control room when that role is enabled |

Staff and automated observations remain separate queues. A useful duplicate becomes supporting evidence rather than disappearing. AI may draft text and suggest a possible match, but a named Validator owns acceptance, severity and linkage.

## Reporter experience

The target is an under-20-second first submission:

1. Choose the website and environment.
2. Paste or confirm the page URL.
3. Paste or upload a screenshot.
4. Crop, blur or redact it if needed.
5. Add one sentence and submit.

The reporter receives notifications when more information is requested, evidence is linked, the issue is accepted, assigned, fixed, re-tested or closed.

## Recognition

Recognition remains deliberately deferred until a real pilot establishes useful-report and duplicate behaviour. If enabled later, use a private, validator-approved ledger and reward useful evidence rather than raw report volume. Exclude restricted security reports and never penalise a good-faith duplicate.

## Rollout gates

- Test every role with 5-10 named staff members.
- Measure submission time, useful-report rate, supporting-evidence rate, validation time, closure time and returning participation.
- Name privacy, security-escalation and backup owners.
- Approve retention and accidental-sensitive-upload procedures.
- Complete a non-production restore exercise.
- Stabilise the internal workflow before adding developer-ticket integration.
- Obtain identity-team approval before replacing named allowlists with an organisation-wide identity group.
