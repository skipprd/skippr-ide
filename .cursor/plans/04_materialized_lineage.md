---
name: materialized lineage
overview: Make lineage a first-class materialized resource cache derived from existing metadata, plans, dbt artifacts, catalog, semantic metadata, and warehouse probes.
status: pending
---

# Materialized Lineage Cache

## Goal

Make lineage navigable and fast without making it the only source of truth. Lineage is derived from authoritative artifacts and cached as a versioned graph resource.

## Sources Of Truth

- `skipprd` metadata: source namespaces, schemas, sink mappings, schema evolution.
- Model plans: intended field lineage, model dependencies, evidence refs.
- dbt files/artifacts: SQL, schema YAML, manifest, compiled relation names.
- Catalog/semantic/profile metadata: fields, dimensions, metrics, semantic claims, stats.
- Warehouse/datalake probes: observed schemas, row counts, distinct/null stats, key/relationship probes.

## Internal Format

Use a Skippr-native lineage graph internally:

- nodes: datasets, tables, fields, models, metrics, catalog entries, resources.
- edges: reads_from, writes_to, derives_from, contains, documents, validates, affects.
- provenance on every edge:
  - source kind;
  - source resource/hash/query id;
  - confidence;
  - revision.

OpenLineage is an import/export adapter later, not the internal canonical format.

## Storage

- Store canonical materialized lineage through `StorageAdapter`:
  - `lineage/current.json`
  - `lineage/snapshots/<revision>.json`
  - `lineage/nodes/*.json`
  - `lineage/edges/*.json`
  - `lineage/index.json`
- Store dry-run lineage under dry-run roots when dry-run exists.
- Add a database/index later only as an API/IDE serving projection if needed.

## IDE Views

- Lineage graph panel.
- Field-level context pane.
- Upstream/downstream impact view.
- Jump links to dbt files, catalog entries, schema diffs, and dry-run changes.

## Acceptance Criteria

- IDE can show lineage for existing BAU artifacts.
- Every lineage edge has provenance and confidence.
- Lineage cache can be rebuilt from source artifacts.
