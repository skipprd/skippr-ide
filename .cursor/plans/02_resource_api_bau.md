---
name: resource api bau
overview: Implement the ResourceService and API over existing BAU data, metadata, dbt artifacts, catalog, semantic metadata, stats, and run state.
status: pending
---

# Resource API Over BAU Data

## Goal

Expose existing Skippr and data-engineer artifacts through a stable resource API for API/IDE use. This is the substrate for BAU browsing, lineage, dry-run diffs, and approval workflows.

## Resource Model

- `ResourceRef`: stable resource address.
- `ResourceContent`: text, JSON, table preview, graph, or structured payload.
- `ResourceContext`: sidecars for lineage, catalog, semantic layer, stats, schemas, diffs, policy notes.
- `ResourcePatch`: typed edit contract for editable resource kinds.

Resources are API/IDE abstractions, not user-facing CLI commands.

## Initial Resource Kinds

- `dbt_model`
- `dbt_schema`
- `catalog_dataset`
- `catalog_field`
- `warehouse_schema`
- `semantic_profile`
- `lineage_graph`
- `run_state`
- `review_artifact`
- `diff`

## Backend Sources

- Existing storage/keyspace for dbt project files.
- Catalog provider for dataset catalog and semantic profiles.
- Query provider for read-only schema/stats probes.
- Thread/control stores for phase and review state.
- Existing `artifacts`, `file`, `catalog_note`, `sql_schema`, and vector tools as implementation references.

## API Shape

- `GET /resources`
- `GET /resources/{id}`
- `GET /resources/{id}/context`
- `GET /resources/{id}/diff`
- `PATCH /resources/{id}`

## Acceptance Criteria

- IDE can list and open dbt models, schema YAML, catalog datasets, catalog fields, semantic metadata, and run/review state through one API.
- API does not leak internal storage path details as the public contract.
- Existing local/S3 storage modes both work through the same API abstraction.
