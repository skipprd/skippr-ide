---
name: hard-cutover
description: >-
  Performs bold delete-and-replace refactors with no migration or legacy shims.
  Use when renaming APIs, collapsing duplicate paths, removing old modules, or when
  the user asks for a hard cutover / no backwards compatibility in Skippr IDE.
---

# Hard cutover (Skippr IDE)

Skippr IDE prefers one clean design over compatibility layers. Overlay files are the source of truth; generated `vscode/` copies are not a second product.

## Rules

1. **One way** — if old and new both exist, delete the old in the same change.
2. **No shims** — MUST NOT add `legacy`, `v1`/`v2` dual handlers, feature flags for “use old path,” or dual-write “for migration.”
3. **Update the graph** — callers, tests, `package.json` `test` script entries, and `docs/` move together.
4. **Rename in place** — prefer rename + fix type/compile errors over adapters that translate forever.
5. **Overlay** — change `overlays/vscode/`, then `npm run apply:overlay`. MUST NOT leave a different implementation in `vscode/` as the real source.
6. **Product UI** — if an in-context control replaces a command-palette / quick-pick flow, delete the prompt path in the same change.

## Workflow

1. Identify the single target shape (types, module, UI).
2. Move/rename implementation to that shape in the overlay.
3. Fix typecheck and tests (`tsc`, `npm test --prefix overlays/vscode/extensions/skippr-workbench`).
4. Delete obsolete files and comments that describe the old world.
5. Drop removed `*.test.ts` files from the workbench `test` script; add new ones.

## Anti-patterns

- “Keep the old function for now”
- Editing both `overlays/vscode/…` and `vscode/…`
- Parallel modules that do the same job (two run-arg builders, two auth hydrators)
- Runtime toggles between implementations
- Palette **and** in-view UI for the same normal product choice
