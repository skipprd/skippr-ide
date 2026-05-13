---
name: approval promotion
overview: Add API/IDE review, edit, approval, rejection, rebase, and atomic promotion for dry-run resources.
status: pending
---

# Approval And Promotion

## Goal

Let users review dry-run resources with context, edit proposed resources in the shadow overlay, approve/reject resources, and atomically promote approved resources to canonical state.

## Invariant

After promotion, a non-dry-run sync/model should reach the same intended resource state, except for source data or external environment drift.

## Resource States

- `pending`
- `approved`
- `rejected`
- `superseded`

## API/IDE Actions

- Approve resource.
- Reject resource.
- Approve dry-run.
- Promote dry-run.
- Rebase dry-run if canonical bases changed.

These are API/IDE product actions, not user-facing CLI workflows.

## Promotion Manifest

Promotion writes should be driven by a validated manifest:

- `run_id`
- approved resource ids
- canonical base revisions/hashes
- shadow revisions/hashes
- target canonical resource refs
- commit marker
- promotion timestamp and actor

## Atomicity

- Local storage: manifest-first and commit-marker protocol.
- S3/object storage: conditional writes where available plus idempotent promotion manifest.
- If true multi-object atomicity is not possible, promotion must be resumable and detectable.

## Safety

- Promotion is the only path from dry-run shadow resources to canonical resources.
- Base revision mismatch blocks promotion unless a safe rebase succeeds.
- Rejected resources remain in the bundle for audit.

## Acceptance Criteria

- IDE can approve/reject individual resources and whole runs.
- Promotion updates all approved canonical resources or leaves the system recoverable with no silent partial state.
- Re-running promotion is idempotent.
- Canonical base drift is detected.
