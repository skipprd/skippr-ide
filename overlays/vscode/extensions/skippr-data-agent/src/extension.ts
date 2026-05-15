import * as vscode from "vscode";
import * as path from "node:path";

type RunTranscriptPayload = {
  stream: "stdout" | "stderr";
  line: string;
  label?: string;
  kind?: string;
};

type ChatProgressEvent = {
  kind: "llm" | "tool" | "final" | "summary";
  status: "running" | "completed" | "failed";
  label: string;
  detail?: string;
};

type ChatProgressPayload = {
  requestId: string;
  event: ChatProgressEvent;
};

let runTranscriptChannel: vscode.LogOutputChannel | undefined;
const activeChatProgress = new Map<string, vscode.ChatResponseStream>();
const chatAttachmentMaxBytes = 128 * 1024;
const chatAttachmentMaxFiles = 8;

function renderChatProgress(event: ChatProgressEvent): string {
  const status = event.status === "running" ? "running" : event.status === "completed" ? "complete" : "failed";
  const prefix = event.kind === "tool" ? "Tool" : event.kind === "llm" ? "LLM" : "Skippr";
  const detail = event.detail ? `: ${event.detail}` : "";
  return `${prefix} ${status}: ${event.label}${detail}`;
}

function isSecretLikePath(fsPath: string): boolean {
  const normalized = fsPath.replace(/\\/g, "/").toLowerCase();
  const base = path.posix.basename(normalized);
  return (
    base === ".env" ||
    base.startsWith(".env.") ||
    normalized.includes("/.env.") ||
    /(^|[/._-])(secret|secrets|credential|credentials|token|private)([/._-]|$)/.test(normalized) ||
    /\.(pem|p8|key)$/i.test(base)
  );
}

function fileReferenceUri(value: unknown): vscode.Uri | undefined {
  if (value instanceof vscode.Uri) {
    return value;
  }
  if (value instanceof vscode.Location) {
    return value.uri;
  }
  if (value && typeof value === "object" && "uri" in value) {
    const uri = (value as { uri?: unknown }).uri;
    if (uri instanceof vscode.Uri) {
      return uri;
    }
  }
  return undefined;
}

async function promptWithAttachedFiles(request: vscode.ChatRequest): Promise<string> {
  const attachments: string[] = [];
  const skipped: string[] = [];
  for (const ref of request.references ?? []) {
    if (attachments.length >= chatAttachmentMaxFiles) {
      skipped.push("additional files");
      break;
    }
    const uri = fileReferenceUri(ref.value);
    if (!uri || uri.scheme !== "file") {
      continue;
    }
    if (isSecretLikePath(uri.fsPath)) {
      skipped.push(path.basename(uri.fsPath));
      continue;
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.File) {
        continue;
      }
      const sizeNote = stat.size > chatAttachmentMaxBytes ? " (large; prefer retrieval)" : "";
      attachments.push(`- ${uri.fsPath}${sizeNote}`);
    } catch {
      skipped.push(path.basename(uri.fsPath));
    }
  }
  if (!attachments.length && !skipped.length) {
    return request.prompt.trim();
  }
  const skippedText = skipped.length ? `\n\nSkipped attachments: ${skipped.join(", ")}` : "";
  return `${request.prompt.trim()}\n\nAttached files:\n${attachments.join("\n")}\n\nUse retrieval for attached files before reading full files: call vect_query with scope "doc" and query_text containing the user's question plus the attached path(s). Treat vector hits as confident only when they clearly reference the attached path and answer-relevant text. If retrieval is empty, ambiguous, or low-confidence, then use file(get) on the attached file path and answer from the file content.${skippedText}`;
}

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
    ),
    vscode.commands.registerCommand(
      "skippr.data-agent.internal.chatProgress",
      async (payload: ChatProgressPayload) => {
        const response = activeChatProgress.get(payload.requestId);
        if (response) {
          response.progress(renderChatProgress(payload.event));
        }
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
      await vscode.authentication.getSession("skippr", ["account"], { createIfNone: true });
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      activeChatProgress.set(requestId, response);
      const prompt = await promptWithAttachedFiles(request);
      const text = await (async () => {
        try {
          return await vscode.commands.executeCommand<string>("skippr.workbench.internal.runChatCli", {
            mode: command,
            prompt,
            progressCommand: "skippr.data-agent.internal.chatProgress",
            progressRequestId: requestId
          });
        } finally {
          activeChatProgress.delete(requestId);
        }
      })();
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
