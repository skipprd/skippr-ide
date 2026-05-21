import * as vscode from "vscode";
import type { SkipprPipelineRunCommand } from "./skipprPipelineRunContext";

/**
 * Opens a pipeline action picker and forwards the config/pipeline as command args.
 * Keeping the payload on the command avoids a stale module-level "next run" slot.
 */
export async function openSkipprPipelineRunMenu(
  configPath: string,
  pipeline: string,
  /** 0-based line index from the code lens provider. */
  _line: number
): Promise<void> {
  const picked = await vscode.window.showQuickPick<
    vscode.QuickPickItem & { command: SkipprPipelineRunCommand }
  >(
    [
      { label: "Discover", command: "discover" },
      { label: "Sync Once", command: "sync" },
      { label: "Model", command: "model" },
      { label: "Lineage", command: "lineage" },
      { label: "Doctor", command: "doctor" }
    ],
    { title: `Run Skippr: ${pipeline}` }
  );
  if (!picked) {
    return;
  }
  await vscode.commands.executeCommand("skippr.run.lensWithArgs", configPath, pipeline, picked.command);
}
