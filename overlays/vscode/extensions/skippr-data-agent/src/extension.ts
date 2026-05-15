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

  const participant = vscode.chat.createChatParticipant("skippr.data-agent", async (request, _ctx, response) => {
    const command = request.command ?? "ask";
    if (command === "model") {
      await vscode.commands.executeCommand("skippr.chat.runModelSubagent");
      response.markdown("Started or attached to the Skippr model run. Use Run/Debug and the Skippr output channel for live logs.");
      return { metadata: { command, mode: "model" } };
    }
    if (command !== "ask" && command !== "plan") {
      response.markdown("Use `/ask`, `/plan`, or `/model` in this chat.");
      return { metadata: { command } };
    }
    try {
      const text = await vscode.commands.executeCommand<string>("skippr.workbench.internal.runChatCli", {
        mode: command,
        prompt: request.prompt
      });
      response.markdown(text ?? "(empty response)");
      return { metadata: { command, mode: command } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      response.markdown(`Skippr chat failed: ${msg}`);
      return { metadata: { command, error: msg } };
    }
  });
  participant.iconPath = new vscode.ThemeIcon("database");
  context.subscriptions.push(participant);
}

export function deactivate(): void {}
