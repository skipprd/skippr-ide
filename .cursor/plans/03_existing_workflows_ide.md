---
name: existing workflows ide
overview: Surface current discover, sync, and model workflows in the IDE using existing CLI/API capabilities before adding full dry-run behavior.
status: pending
---

# Existing Workflows In IDE

## Goal

Make the IDE useful with current Skippr workflows before the dry-run transaction system is complete.

## Scope

- Discover panel:
  - run/observe existing discover flow;
  - show discovered namespaces, schemas, stats, metadata summary.
- Sync panel:
  - run/observe existing sync flow;
  - show progress, rows/bytes, status, errors, metadata updates.
- Model panel:
  - run/observe current data-engineer model flow;
  - show phases, plans, dbt artifacts, validation, review, publish state.
- Shared diagnostics:
  - logs;
  - phase transitions;
  - validation errors;
  - generated artifacts.

## Implementation Notes

- Use existing CLI/headless pathways where necessary.
- Prefer API-backed state and ResourceService reads for UI rendering.
- Do not invent new workflow semantics in the IDE; mirror current behavior.

## Acceptance Criteria

- User can launch or observe discover/sync/model from the IDE.
- User can see status, outputs, errors, and generated artifacts without leaving the IDE.
- Existing CLI remains compatible and unchanged in user-facing behavior.
