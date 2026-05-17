# AGENTS.md

## Skippr IDE overlay workflow

This repository builds a Skippr IDE desktop app from a VS Code fork. Treat `overlays/vscode/` as the source of truth for Skippr-owned files that are copied into the VS Code checkout.

When changing the built-in Skippr workbench extension:

1. Edit files under `overlays/vscode/extensions/skippr-workbench/`.
2. Run `npm run apply:overlay` from the repository root to refresh the generated copy under `vscode/extensions/skippr-workbench/`.
3. Compile and test from the applied `vscode/` tree, because dev/build scripts run the extension from there.

Do not manually patch both `overlays/vscode/extensions/skippr-workbench/` and `vscode/extensions/skippr-workbench/` unless explicitly asked. Manual dual edits are easy to drift; prefer overlay source edits plus the apply script.
