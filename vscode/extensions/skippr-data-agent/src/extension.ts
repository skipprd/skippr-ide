import * as vscode from "vscode";

type RunTranscriptPayload = {
  stream: "stdout" | "stderr";
  line: string;
  label?: string;
  kind?: string;
};

let runTranscriptChannel: vscode.LogOutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const noop = async () => undefined;

  context.subscriptions.push(
    vscode.commands.registerCommand("skippr.dataAgent.output.extensionState", noop),
    vscode.commands.registerCommand("skippr.dataAgent.generateCommitMessage", noop),
    vscode.commands.registerCommand("skippr.dataAgent.resolveMergeConflicts", noop),
    vscode.commands.registerCommand("skippr.dataAgent.showCompletionsMenu", noop),
    vscode.commands.registerCommand(
      "skippr.data-agent.internal.appendRunTranscript",
      async (payload: RunTranscriptPayload) => {
        if (!runTranscriptChannel) {
          runTranscriptChannel = vscode.window.createOutputChannel("Skippr run → chat", { log: true });
        }
        runTranscriptChannel.appendLine(
          `[${payload.stream}] ${payload.label ?? "skippr"}${payload.kind ? ` (${payload.kind})` : ""}: ${payload.line}`
        );
      }
    )
  );
}

export function deactivate(): void {}
