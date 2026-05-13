import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { ConnectionSettings, SkipprPanelId, SkipprPanelName, SkipprPanelPayload } from "./types";

const execFileAsync = promisify(execFile);

function fallbackPayload(
  panelId: SkipprPanelId,
  panelName: SkipprPanelName,
  settings: ConnectionSettings,
  reason: string
): SkipprPanelPayload {
  return {
    panelId,
    panelName,
    resources: [{ id: "fallback", label: "fallback_resource", kind: "source", path: "sources/fallback.yml" }],
    catalog: [{ id: "fallback", name: "fallback_table", owner: "skippr", tags: ["mock"], updatedAt: "2026-05-13" }],
    diff: { model: "fallback_model", before: ["id"], after: ["id", "new_column"] },
    lineage: {
      nodes: [
        { id: "a", label: "fallback_source", type: "source" },
        { id: "b", label: "fallback_model", type: "model" }
      ],
      edges: [{ from: "a", to: "b" }]
    },
    diagnostics: [`Rust bridge fallback: ${reason}`],
    settings
  };
}

export async function loadPanelPayloadFromRust(
  extensionRoot: string,
  panelId: SkipprPanelId,
  panelName: SkipprPanelName,
  settings: ConnectionSettings
): Promise<SkipprPanelPayload> {
  const repoRoot = path.resolve(extensionRoot, "../../../../..");
  const rustManifest = path.resolve(repoRoot, "rust-core/Cargo.toml");

  try {
    const args = [
      "run",
      "--quiet",
      "--manifest-path",
      rustManifest,
      "--",
      "--panel-id",
      panelId,
      "--panel-name",
      panelName,
      "--workspace-path",
      settings.workspacePath,
      "--api-target",
      settings.apiTarget ?? ""
    ];
    const { stdout } = await execFileAsync("cargo", args, { cwd: repoRoot });
    return JSON.parse(stdout.trim()) as SkipprPanelPayload;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return fallbackPayload(panelId, panelName, settings, message);
  }
}
