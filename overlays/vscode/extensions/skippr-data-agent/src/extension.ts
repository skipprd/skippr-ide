import * as vscode from "vscode";
import * as path from "node:path";

type RunTranscriptPayload = {
  stream: "stdout" | "stderr";
  line: string;
  label?: string;
  kind?: string;
};

type ChatProgressEvent = {
  kind: "phase" | "llm" | "tool" | "final" | "summary" | "approval";
  status: "running" | "completed" | "failed";
  label: string;
  id?: string;
  phase?: string;
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
  const prefix = event.kind === "tool" ? "Tool" : event.kind === "llm" ? "LLM" : event.kind === "phase" ? "Phase" : event.kind === "approval" ? "Approval" : "Skippr";
  const context = event.phase && event.kind !== "phase" ? ` (${event.phase})` : "";
  const detail = event.detail ? `: ${event.detail}` : "";
  return `${prefix} ${status}: ${event.label}${context}${detail}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function approvalCardMarkdown(prompt: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString(
    `<div style="border:1px solid #3c3c3c;background:#111;padding:8px;border-radius:0;color:#d4d4d4;font-size:12px;line-height:1.35">
<div style="font-weight:600;color:#fff;margin-bottom:4px">Approval required</div>
<div>${escapeHtml(prompt)}</div>
</div>`
  );
  md.supportHtml = true;
  return md;
}

function renderApprovalCard(response: vscode.ChatResponseStream, approvalId: string, prompt: string): void {
  response.markdown(approvalCardMarkdown(prompt));
  response.button({
    command: "skippr.workbench.internal.chatApprovalDecision",
    title: "Approve",
    arguments: [{ approvalId, approved: true }]
  });
  response.button({
    command: "skippr.workbench.internal.chatApprovalDecision",
    title: "Reject",
    arguments: [{ approvalId, approved: false }]
  });
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

type ChatContextFile = {
  name: string;
  path: string;
  uri: string;
  external: boolean;
  large?: boolean;
};

type ChatContextEnvelope = {
  user: string;
  execution_surface: "ide_chat";
  context?: {
    files?: ChatContextFile[];
    skipped_files?: string[];
  };
};

async function chatContextEnvelopeForRequest(request: vscode.ChatRequest): Promise<string> {
  const files: ChatContextFile[] = [];
  const skipped: string[] = [];
  for (const ref of request.references ?? []) {
    if (files.length >= chatAttachmentMaxFiles) {
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
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      const rel = folder ? path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, "/") : uri.fsPath;
      files.push({
        name: path.basename(uri.fsPath),
        path: folder ? `./${rel}` : uri.fsPath,
        uri: uri.toString(),
        external: !folder,
        large: stat.size > chatAttachmentMaxBytes || undefined
      });
    } catch {
      skipped.push(path.basename(uri.fsPath));
    }
  }
  const envelope: ChatContextEnvelope = { user: request.prompt.trim(), execution_surface: "ide_chat" };
  if (files.length || skipped.length) {
    envelope.context = {};
    if (files.length) {
      envelope.context.files = files;
    }
    if (skipped.length) {
      envelope.context.skipped_files = skipped;
    }
  }
  return JSON.stringify(envelope);
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
          if (payload.event.kind === "approval" && payload.event.status === "running" && payload.event.id && payload.event.detail) {
            renderApprovalCard(response, payload.event.id, payload.event.detail);
            return;
          }
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
      const prompt = await chatContextEnvelopeForRequest(request);
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
