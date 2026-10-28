# Skippr IDE adversarial cutover

SoT: overlay `overlays/vscode/` decides product UI and layout. In-context buttons/forms are legal; `showQuickPick` / `showInputBox` for product choices are illegal (OTP in `skipprOverlayUi.ts` is the credential-shell exception). Observational views default to the bottom panel; Connections is the only activity-bar icon. Agent review is `vscode.diff` on `skippr-before:` vs the workspace file. One `configuration` and one `submenus` in workbench `package.json`. CLI child env is `mergeSkipprSpawnEnvWithLocalRuntimePlugins` (`skipprSpawnEnv` in `extension.ts` is the local wrapper). `rustBridge` / `rust-core` are deleted.

Generated `/vscode/` and packaged `VSCode-*` trees are not source.

## Deleted

- Duplicate `contributes.configuration` / `submenus` last-wins in workbench `package.json`
- Lineage + Dashboards activity-bar containers; debug views in the workbench contrib
- `forceActivityBar` calls from activate and business layout
- Product QuickPick / InputBox menus (lineage, lens, ask, dashboards, cloud file menu, pipeline env, buy-credits amount, setup project name, `pickRunMode`)
- `promptAndOpenCloudWorkspace` / `promptAndCreateCloudWorkspace`
- `rustBridge.ts`, `rust-core/`, unused `SkipprPanel*` types, `build:rust`, rust-style rule
- Apply-script self-copy of layout (now copies overlay `skipprPinnedWorkbenchLayout.ts`)
- Unregistered `skippr.showPipelineRunMenu` (now registered; `skippr.pipelineRun` lives on skippr.yml editor/context)
- Local already-running conflict that only `output.show`’d (now `revealSkipprRunPanel`)
- `skippr.open.discover` / `skippr.open.sync` activity stubs and `panelSpecs` dispatcher
- `skippr.open.model` twin of `skippr.run.modelPipeline`
- `skippr.run.pickPipelineAction` adapter (code lens chevron is `skippr.showPipelineRunMenu`)
- Palette-visible `skippr.dashboard.addFromEditor` / `skippr.sql.setRunModeSql` / `skippr.sql.setRunModeTests`
- Palette-visible doctor / stop / SQL run / File-menu splash duplicates `skippr.cloud.open` / `skippr.cloud.create`
- Dual run-timeline label maps (`modelEventLabel` / `eventDetail`)
- Palette-visible `skippr.schemaDiff.openReview` (Run timeline already opens schema review)

## Surviving design

- Connections-only activity bar; Run / Deadletters / Results / Lineage / Dashboards in the panel
- Lineage graph is webview view `skippr.lineageGraph`, not an editor tab
- Dashboard create/add/model uses `skippr.dashboards.form`
- Cloud open/create File menu opens the splash (button list + YAML form)
- Agent `file_edit` opens `openSkipprAgentFileDiff`
- `RUN_KIND_LABELS` in `skipprRunKinds.ts` is the only run-label map
- `describeRunEvent` / `describedRunEvents` is the only run-timeline event copy
- Tests: `rm -rf out && tsc -p ./ && node --test --test-force-exit 'out/**/*.test.js'`

## Out of scope / blocker

- `SkipprCliAgent` is not in the overlay (A-2). Workbench-owned `skippr-before` + `vscode.diff` is the agent-review SoT.
- `extension.ts` split (S-1) is not this slice; do not half-split it.
- OTP `showInputBox` in `skipprOverlayUi.ts` stays as the auth shell.
- Copilot command remaps in `skippr-data-agent` stay because `product.overrides.json` owns those IDs.
- Dashboard *list* and *form* live in the bottom panel. Rendered dashboard preview and Business Insights are editor documents, not a second observational container.
