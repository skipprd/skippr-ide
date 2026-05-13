---
name: dry run resources diffs
overview: Add dry-run bundles and resource diffs for discover, sync, and model without production mutations or a new execution dialect.
status: pending
---

# Dry-Run Resources And Diffs

## Goal

Add dry-run support that captures proposed metadata/schema/model/resource changes under a canonical dry-run root and exposes them through the same ResourceService used for BAU artifacts.

## Storage

- Local: `.skippr/dry-runs/<run_id>/`
- S3: equivalent scoped prefix under configured project storage.

Bundle contents:

- `summary.json`
- `resources/`
- `diffs/index.json`
- `metadata/before.json`
- `metadata/after.shadow.json`
- `schemas/`
- `catalog/`
- `lineage/`
- `bytes.json`
- `graph.json`

## Discover Dry-Run

- Run discovery and schema collection paths.
- Do not write canonical metadata.
- Do not enqueue production schema sync.
- Do not cleanup destructively.
- Emit metadata/schema/resource diffs.

## Sync Dry-Run

- Use canonical metadata as `before`.
- If metadata is absent, run dry-run discover internally.
- Capture proposed metadata/schema/resource changes.
- Estimate rows/bytes where existing code can do so without production mutations.
- Do not advance offsets, mutate WAL, write production sinks, publish schemas, or send metrics.

## Model Dry-Run

- Run planning/authoring into a shadow dbt/project overlay.
- Keep SQL dialect aligned to the configured production warehouse.
- Use read-only schema/probe tools where safe.
- Skip production `dbt build`, publish, and warehouse materialization.
- Emit model SQL/YAML diffs, schema contract diffs, manifest/relation diffs, lineage graph nodes.

## Deferred

- DataFusion-backed local execution.
- Skippr dry-run data sink/schema sink.
- Skippr warehouse provider.

## Acceptance Criteria

- Dry-run creates a bundle readable by API/IDE.
- Production metadata/data/schema/offset/WAL state is not mutated.
- Dry-run resources appear in the same IDE tree shape as BAU resources.
