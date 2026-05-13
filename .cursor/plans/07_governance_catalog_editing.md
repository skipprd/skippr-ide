---
name: governance catalog editing
overview: Add structured catalog/semantic editing, governance notes, policy checks, and review context on top of the resource and lineage substrate.
status: pending
---

# Governance And Catalog Editing

## Goal

Make catalog and semantic layer edits first-class, reviewable resources with lineage, stats, and policy context.

## Scope

- Structured catalog edits:
  - dataset description;
  - field description;
  - synonyms;
  - PII sensitivity;
  - units/format;
  - dimensions/metrics;
  - semantic claims.
- Governance notes:
  - preserve current note/digest behavior;
  - connect notes to ResourceRef and lineage context.
- Policy checks:
  - missing owner/steward where required;
  - PII fields without classification;
  - metric/model changes without enough evidence;
  - unverified key/grain/relationship claims.

## Resource Integration

- Catalog and semantic edits use the same ResourceService patch model.
- Edits can target canonical resources or dry-run shadow resources.
- Promotion handles approved catalog/semantic edits alongside dbt/model/schema resources.

## IDE Views

- Catalog browser.
- Field detail editor.
- Semantic profile view.
- Governance notes and provenance pane.
- Policy findings panel linked to resources and lineage edges.

## Acceptance Criteria

- User can edit catalog/semantic resources in the IDE.
- Governance notes are linked to resources and lineage context.
- Policy findings are surfaced during BAU browsing and dry-run review.
- Approved catalog/semantic edits can be promoted with other dry-run resources.
