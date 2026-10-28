import * as vscode from "vscode";
import { setSkipprPipelineLensTarget } from "./skipprPipelineLensContext";

/**
 * Opens the Skippr pipeline run submenu in the editor context menu beside skippr.yml,
 * not the command palette quick pick.
 */
export function registerSkipprPipelineRunMenu(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "skippr.showPipelineRunMenu",
      async (configPath?: unknown, pipeline?: unknown) => {
        if (typeof configPath === "string" && typeof pipeline === "string" && pipeline.trim()) {
          setSkipprPipelineLensTarget(configPath.trim(), pipeline.trim());
        }
        await vscode.commands.executeCommand("editor.action.showContextMenu");
      }
    )
  );
}
