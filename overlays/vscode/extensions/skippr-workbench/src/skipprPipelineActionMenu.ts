import * as vscode from "vscode";
import { setSkipprPipelineLensTarget } from "./skipprPipelineLensContext";

/**
 * Opens the Skippr pipeline run submenu beside the code lens (workbench context menu),
 * not the command palette quick pick.
 */
export async function openSkipprPipelineRunMenu(
  configPath: string,
  pipeline: string,
  /** 0-based line index from the code lens provider. */
  line: number
): Promise<void> {
  setSkipprPipelineLensTarget(configPath.trim(), pipeline.trim());
  const lineNumber = Number.isFinite(line) ? line + 1 : undefined;
  await vscode.commands.executeCommand("skippr.showPipelineRunMenu", lineNumber);
}
