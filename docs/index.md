# Skippr IDE

Skippr IDE is a desktop workbench. It drives **`sde`** (Skippr Data Engineer). `sde` invokes **`skipprd`** on PATH for discover and sync.

**Source-available** under PolyForm Shield 1.0.0, not OSI open source. VS Code upstream remains MIT; the Skippr overlay in this repo is Shield.

## Install

Download the darwin arm64 desktop artifact from [GitHub Releases](https://github.com/skipprd/skippr-ide/releases). Windows and linux desktop builds come later.

```bash
brew tap skipprd/tap
brew install sde skipprd
```

## Workbench

Discover, Sync, Model, Catalog, and Lineage panels call `sde`. Engine jobs (`discover` / `sync`) run through `skipprd`.

- [Skippr Data Engineer](https://data-engineer.skippr.io)
- [Skipprd](https://elt.skippr.io)
