import * as vscode from "vscode";
import { setPendingPipelineLensRun } from "./skipprPipelineRunContext";

/**
 * Opens the native Run Skippr context menu (requires workbench compile).
 * Falls back to no-op if the workbench command is not registered yet.
 */
export async function openSkipprPipelineRunMenu(
  configPath: string,
  pipeline: string,
  /** 0-based line index from the code lens provider. */
  line: number
): Promise<void> {
  setPendingPipelineLensRun(configPath, pipeline);
  const lineNumber = line + 1;
  try {
    await vscode.commands.executeCommand("skippr.showPipelineRunMenu", lineNumber);
  } catch {
    // Workbench handler not compiled in this dev build — gutter uses inline code lens actions instead.
  }
}
