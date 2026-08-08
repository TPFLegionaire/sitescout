# Site Scout privacy operations

Status: staff-screenshot controls remain in dry-run mode. Strix raw-import artifacts use a separate active retention policy described below.

## Current technical controls

- Staff evidence remains private and is served with `private, no-store` caching.
- Each screenshot is signature-checked, limited to 5 MB and, for editor submissions, re-encoded as a metadata-stripped PNG.
- A report may contain at most 10 evidence assets and 25 MB of newly tracked evidence.
- Reporters can see only their own evidence. Validators and Administrators can review restricted security reports. A Finding Owner sees restricted evidence only after the report is deliberately assigned to that exact owner.
- A potential security report is excluded from normal Finding Owner visibility before assignment. Reporters are warned never to include credentials, tokens, customer data or other confidential material.
- Legal-hold fields exist in the data model. No user interface can activate deletion while the policy mode is `dry-run`.

## Proposed retention and backup settings

| Control | Proposed value | Current status |
|---|---:|---|
| Standard screenshot retention | 180 days | Preview only |
| Restricted staff screenshot retention | No automatic expiry | Manual decision required |
| Raw Strix import retention | 30 days by default (1–365 configurable) | Daily purge and Administrator deletion enabled |
| Backup frequency | Daily | Not configured |
| Backup retention | 30 days | Not configured |
| Restore exercise | Before pilot launch and quarterly | Not yet tested |

The dashboard reports how many staff screenshot assets would expire under the proposal, how many are protected as security evidence, how much newly tracked storage is used and how many legacy assets lack size metadata. It does not delete staff screenshot evidence. Raw Strix imports are separate: private R2 objects are removed by the Worker retention job or an Administrator action, while sanitised candidates and review history are retained.

## Decisions required before activation

1. Name the Privacy Administrator, Security Escalation Owner and Backup Owner.
2. Approve or amend the proposed retention periods and confirm the lawful/business basis.
3. Define the route for correcting or deleting an accidental sensitive upload.
4. Confirm the backup location, access list, encryption responsibility and restore procedure.
5. Run a documented restore exercise using non-production data.
6. Obtain explicit approval before changing the staff screenshot policy from `dry-run` to an active deletion mode.
7. Reconcile R2 versioning, backups and exported copies with the Strix raw-artifact retention period.

## Incident handling

If a screenshot contains personal, customer, credential or confidential material, stop normal review, restrict access to an Administrator and the Security Escalation Owner, preserve the attributable audit record, and follow the approved incident/deletion process. Do not place restricted security reports into recognition, leaderboard or public notification channels.
