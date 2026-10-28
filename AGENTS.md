# AGENTS.md — Skippr IDE

This repository builds **Skippr IDE**, a desktop workbench from a VS Code fork. Overlay files under `overlays/vscode/` are the source of truth. The workbench drives **`sde`**, which invokes **`skipprd`** on PATH.

Public docs: [ide.skippr.io](https://ide.skippr.io). Markdown is `docs/`.

## Overlay workflow

Treat `overlays/vscode/` as the source of truth for Skippr-owned files copied into the VS Code checkout. `/vscode/` is generated (gitignored). Do not edit `vscode/` or packaged app trees (`VSCode-darwin-arm64/`, …) as the product source.

When changing a built-in Skippr extension:

1. Edit files under `overlays/vscode/extensions/<extension>/`.
2. Run `npm run apply:overlay` from the repository root to refresh the generated copy under `vscode/extensions/`.
3. Compile and test from the applied `vscode/` tree, because dev/build scripts run the extension from there.

Do not manually patch both `overlays/vscode/…` and `vscode/…` unless explicitly asked. Dual edits drift; prefer overlay source plus the apply script.

## Product UI

When implementing Skippr IDE product interactions, use in-context buttons and forms in Skippr views. Do not use command palette, `showQuickPick`, or `showInputBox` for product choices. The only exception is OTP email/code in `skipprOverlayUi.ts` (credential shell).

One UI path per choice. If an in-context control replaces a palette/quick-pick flow, delete the old prompt in the same change.

## Design principles (priority order)

When making changes, follow these in order:

1. **One design:** One authority, type, and UI path per job. If two ways exist, delete the old in the same change (no shims, dual-write, feature flags, or “keep for now”). Overlay vs generated `vscode/` is not two designs — overlay wins. Skill: `.cursor/skills/hard-cutover`.

2. **Types over runtime convention:** Prefer unions, branded types, and enums over string modes and “don’t call this wrong.” If an invariant can be enforced by TypeScript (`strict`) or Rust, it must be. Illegal states should not be nameable. `skipprRunner.type-tests.ts` is the pattern for compile-time illegal combinations. Always favour a type error over a runtime convention.

3. **Design simplicity:** Favour the simplest design that satisfies the requirements. Avoid over-abstraction. A flat function is better than a class hierarchy with one implementor. If a module exists only to re-export, remove the indirection. Simple, consistent, clean code beats clever code.

4. **DRY:** Extract shared logic into functions or shared modules. Duplicated error messages, CLI argv builders, or serialization patterns are bugs waiting to diverge.

5. **Reuse into that one design:** Prefer extending an existing module over a new package. Reuse MUST NOT mean keeping a second path, adapter, or “legacy” module beside the chosen design.

6. **TDD for logic:** Write the failing test first for domain logic (run state, JWT, schema, CLI args, cancel, lineage). Skill: `.cursor/skills/tdd-ide`. This is a desktop workbench, not a kernel — do not invent deterministic simulation, property, or fuzz harnesses. UI layout and webview HTML are verified in the running app, not by a five-layer test stack.

## Testing

| Kind | Role | Where |
|------|------|--------|
| Unit | Pure functions, parsers, state, codecs | Colocated `*.test.ts` next to the module; `node:test` |
| Type | Illegal states unrepresentable | `*.type-tests.ts` (`@ts-expect-error`) |
| App | Product UI, panels, overlays | Running Skippr IDE (`npm run dev` + `vscode/scripts/code.sh`) |

Workbench unit tests: `overlays/vscode/extensions/skippr-workbench` (`npm test`). The test script is `rm -rf out && tsc -p ./ && node --test --test-force-exit 'out/**/*.test.js'`. Type-only files are checked by `tsc`, not `node --test`.

Do not use `sleep`, wall-clock races, or live network as correctness for unit tests. Live `sde` / `skipprd` loops are for developer verification, not the unit suite.

## Documentation

| Layer | Where | Audience |
|-------|--------|----------|
| **Agent / maintainer** | This file, `.cursor/rules/`, `.cursor/skills/` | How to change the repo |
| **Plans** | `.cursor/plans/` | Sequencing, not runtime truth |
| **Public** | `docs/` | Customers — how to install and use the IDE |

Behavior that users see belongs in `docs/` in the same change when it is customer-facing. Do not treat plans as the live product contract.

## Build, test, and lint

```bash
npm run apply:overlay
npm test --prefix overlays/vscode/extensions/skippr-workbench
npm run verify:fork
```

- Node `22.22.1` (scripts auto-switch with `nvm` if available).
- Format TypeScript to match the file you edit.
- Do not add `-D warnings` to clippy unless asked.

Inner loop: `npm run dev` (watch) and, in another terminal, `cd vscode && ./scripts/code.sh`. After overlay edits, re-apply and reload the Extension Development Host.

## Agent checklist

1. Edit `overlays/vscode/`, not `vscode/` or packaged app trees.
2. Encode invariants in types; delete dead/legacy paths in the same change.
3. Product choices stay in-context (OTP InputBox in `skipprOverlayUi.ts` is the only exception).
4. Tests first for domain logic; glob `out/**/*.test.js` after `tsc`. Verify UI in the running app.
5. `npm run apply:overlay` before claiming a workbench change is ready to run.
6. Keep `sde` / `skipprd` as the engines — do not reimplement discover/sync/model inside the IDE.
