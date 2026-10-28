---
name: tdd-ide
description: >-
  Test-driven development for Skippr IDE: write failing tests first for domain
  logic, then implement until green. Use when adding or changing workbench
  TypeScript, overlay scripts, or verification. Not a kernel simulation/fuzz
  stack.
---

# TDD for Skippr IDE

Rule: `.cursor/rules/tdd.mdc`. This is a desktop workbench. Do not import ReAct/Cloud simulation, property, or fuzz requirements.

## Rules

1. **Red → green → refactor.** No domain-logic feature code without a failing test written first.
2. **Unit + types.** Colocated `*.test.ts` with `node:test`. Compile-time illegal states in `*.type-tests.ts`. Cover success and reasonable failure (bad JWT, missing pipeline, cancel while running).
3. **Glob tests.** New workbench `*.test.ts` files are compiled then run by `scripts.test` (`rm -rf out && tsc && node --test 'out/**/*.test.js'`).
4. **No external side effects** in the unit suite. MUST NOT `sleep` as correctness. MUST NOT call live `sde` / `skipprd` / network as the unit bar.
5. **Hard cutover.** Delete obsolete tests with obsolete code; no dual suites.
6. **UI.** Webview HTML, layout, and in-context menus are verified in the running app, not with a fake kernel.

## Layout

| Kind | Location |
|------|----------|
| Unit | `overlays/vscode/extensions/skippr-workbench/src/*.test.ts` |
| Type | `overlays/vscode/extensions/skippr-workbench/src/*.type-tests.ts` |
| App | `npm run dev` + `vscode/scripts/code.sh` |

## Workflow

1. Write the failing test at the layer that would have caught the bug.
2. Implement the minimum to pass.
3. `npm test --prefix overlays/vscode/extensions/skippr-workbench`.
4. For UI, apply overlay and check the running workbench.

## Commands

```bash
npm test --prefix overlays/vscode/extensions/skippr-workbench
npm run apply:overlay
```

## Anti-patterns

- Implementing first, tests later
- Sleep / wall-clock races / live engine as unit correctness
- A second test-only implementation next to production
- Inventing deterministic simulation or `cargo fuzz` for this repo
