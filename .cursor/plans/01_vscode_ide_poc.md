---
name: vscode ide poc
overview: Create the first VSCode-based Skippr IDE shell with panels for Discover, Sync, Model, Catalog, and Lineage using existing or mocked data.
status: pending
---

# VSCode IDE PoC

## Goal

Create a usable IDE shell early, before the full dry-run/resource backend exists. The PoC should prove navigation, layout, and workflow ergonomics.

## Scope

- Fork and customize VSCode in /Users/huders2000/Documents/sites/skippr/skippr-ide
- Add Skippr activity bar entry.
- Add panels:
  - Discover
  - Sync
  - Model
  - Catalog
  - Lineage
- Add placeholder resource tree and detail pane.
- Add mock diff and lineage views for product iteration.

## UX Principles

- Feel like opening files in an IDE: tree, editor, details, diagnostics.
- Use the same layout for BAU resources and future dry-run diff resources.
- Keep CLI visible as an implementation mechanism, not as the main UX.

## Implementation Steps

1. Create app shell in `skippr-ide`.
2. Add extension/panel routing.
3. Add tree/detail/editor layout.
4. Add mock adapters for resource lists, catalog entries, schema diffs, and lineage graphs.
5. Add basic connection settings for local workspace/API target.

## Acceptance Criteria

- User can open the Skippr IDE and see Discover, Sync, Model, Catalog, and Lineage panels.
- User can navigate a mock resource tree and open detail views.
- User can preview a mock schema/model diff with contextual lineage/catalog side panel.
