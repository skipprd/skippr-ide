import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { SkipprRunEvent } from "./types";

function forwardRunTranscriptLine(
  label: string,
  kind: string,
  line: string,
  stream: "stdout" | "stderr"
): void {
  const trimmed = line.trimEnd();
  if (!trimmed) {
    return;
  }
  void vscode.commands
    .executeCommand("skippr.data-agent.internal.appendRunTranscript", {
      stream,
      line: trimmed,
      label,
      kind
    })
    .then(undefined, () => undefined);
}

export type SkipprRunKind = "discover" | "sync-once" | "sync-all-once" | "sync" | "model";

export interface SkipprRunOptions {
  kind: SkipprRunKind;
  cliPath?: string;
  cwd: string;
  configPath?: string;
  pipeline?: string;
  logLevel: string;
  /** `skippr discover --output` (CLI: progress | json | text). */
  discoverOutput?: string;
  /** When true, pass `skippr model --no-resume`. */
  modelNoResume?: boolean;
  /** Appended after built flags (e.g. from the Run panel “Args” field). */
  extraArgs?: string[];
  /** When set, used as the child process environment (typically `process.env` merged with Skippr settings). */
  spawnEnv?: NodeJS.ProcessEnv;
}

export interface SkipprRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  elapsedMs: number;
  lastEvent?: SkipprRunEvent;
}

export interface SkipprProcess {
  readonly kind: SkipprRunKind;
  readonly label: string;
  readonly done: Promise<SkipprRunResult>;
  stop(): void;
}

export interface SkipprRunnerCallbacks {
  onEvent(event: SkipprRunEvent): void;
  onLog(line: string): void;
}

export interface SkipprJsonCommandResult<T> {
  code: number | null;
  signal: NodeJS.Signals | null;
  elapsedMs: number;
  value?: T;
  stdout: string;
}

const installerCommand = "curl -fsSL https://install.skippr.io/install.sh | sh -";
const localCargoCli = "__skippr_local_cargo__";

export async function resolveSkipprCli(configuredPath: string | undefined): Promise<string | undefined> {
  if (resolveLocalSkipprdManifest()) {
    return localCargoCli;
  }

  const trimmed = configuredPath?.trim();
  if (trimmed) {
    return trimmed;
  }

  return undefined;
}

export async function installSkipprCli(output: vscode.LogOutputChannel): Promise<SkipprRunResult> {
  output.show(true);
  output.info(`Installing Skippr CLI with: ${installerCommand}`);
  return runShellCommand(installerCommand, output);
}

export async function updateSkipprCli(
  cliPath: string | undefined,
  output: vscode.LogOutputChannel,
  spawnEnv: NodeJS.ProcessEnv = process.env
): Promise<SkipprRunResult> {
  output.show(true);
  if (cliPath) {
    const update = await runCommand(buildCliCommand(cliPath, ["update"]), output, cliCommandCwd(cliPath), spawnEnv);
    if (update.code === 0) {
      return update;
    }
    output.warn("`skippr update` failed or is not supported; falling back to installer.");
  }
  output.info(`Updating Skippr CLI with: ${installerCommand}`);
  return runShellCommand(installerCommand, output);
}

export async function showSkipprVersion(
  cliPath: string,
  output: vscode.LogOutputChannel,
  spawnEnv: NodeJS.ProcessEnv = process.env
): Promise<SkipprRunResult> {
  output.show(true);
  output.info(`Checking Skippr CLI version: ${formatCliCommand(cliPath, ["--version"])}`);
  return runCommand(buildCliCommand(cliPath, ["--version"]), output, cliCommandCwd(cliPath), spawnEnv);
}

export interface SkipprChatJsonlRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  elapsedMs: number;
  lines: unknown[];
  stderr: string;
  stdout: string;
}

/** Run `skippr chat send --output jsonl` and collect parsed JSON lines from stdout. */
export async function runSkipprChatJsonl(
  cliPath: string,
  configPath: string,
  pipeline: string,
  mode: "ask" | "plan" | "agent",
  message: string,
  cwd: string,
  output: vscode.LogOutputChannel,
  spawnEnv: NodeJS.ProcessEnv = process.env
): Promise<SkipprChatJsonlRunResult> {
  const args = [
    "--config",
    configPath,
    "chat",
    "send",
    "--pipeline",
    pipeline,
    "--mode",
    mode,
    "--message",
    message,
    "--output",
    "jsonl"
  ];
  const startedAt = Date.now();
  const [command, ...commandArgs] = buildCliCommand(cliPath, args);
  output.info(`$ ${formatCliCommand(cliPath, args)}`);
  const child = spawn(command, commandArgs, { cwd: cliCommandCwd(cliPath) ?? cwd, env: spawnEnv, shell: false });
  let stdout = "";
  let stderr = "";
  let buf = "";
  const lines: unknown[] = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    buf += chunk;
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (!line) {
        continue;
      }
      forwardRunTranscriptLine("skippr-chat", "chat-jsonl", line, "stdout");
      try {
        lines.push(JSON.parse(line) as unknown);
      } catch {
        output.warn(`[skippr chat] non-JSON stdout line: ${line}`);
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    forwardRunTranscriptLine("skippr-chat", "chat-jsonl", chunk, "stderr");
    output.info(chunk.trimEnd());
  });
  return new Promise((resolve) => {
    child.on("error", (error) => {
      output.error(error.message);
      resolve({
        code: 1,
        signal: null,
        elapsedMs: Date.now() - startedAt,
        lines,
        stderr: stderr + error.message,
        stdout
      });
    });
    child.on("close", (code, signal) => {
      const tail = buf.trim();
      if (tail) {
        try {
          lines.push(JSON.parse(tail) as unknown);
        } catch {
          if (tail) {
            output.warn(`[skippr chat] non-JSON stdout tail: ${tail}`);
          }
        }
      }
      resolve({ code, signal, elapsedMs: Date.now() - startedAt, lines, stderr, stdout });
    });
  });
}

function assistantSnippetFromChatJsonlObject(line: unknown): string | undefined {
  if (!line || typeof line !== "object") {
    return undefined;
  }
  const o = line as Record<string, unknown>;
  if (o.type === "ChatSummary") {
    return undefined;
  }
  for (const [, v] of Object.entries(o)) {
    if (!v || typeof v !== "object") {
      continue;
    }
    const inner = v as Record<string, unknown>;
    if (typeof inner.display === "string" && inner.display.trim()) {
      return inner.display.trim();
    }
    const result = inner.result as Record<string, unknown> | undefined;
    const payload = result?.payload as Record<string, unknown> | undefined;
    if (payload) {
      if (typeof payload.answer === "string" && payload.answer.trim()) {
        return payload.answer.trim();
      }
      if (typeof payload.text === "string" && payload.text.trim()) {
        return payload.text.trim();
      }
    }
  }
  return undefined;
}

/** Parse `skippr chat send --output jsonl` lines into UI markdown and summary metadata. */
export function parseSkipprChatResultFromJsonl(lines: unknown[]): {
  ok: boolean;
  threadId?: string;
  assistantMarkdown: string;
} {
  let ok = false;
  let sawSummary = false;
  let threadId: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || typeof line !== "object") {
      continue;
    }
    const o = line as Record<string, unknown>;
    if (o.type === "ChatSummary") {
      sawSummary = true;
      ok = Boolean(o.ok);
      if (typeof o.thread_id === "string" && o.thread_id.trim()) {
        threadId = o.thread_id.trim();
      }
      break;
    }
  }
  if (!sawSummary && lines.length > 0) {
    ok = true;
  }
  const parts: string[] = [];
  for (const line of lines) {
    const s = assistantSnippetFromChatJsonlObject(line);
    if (s) {
      parts.push(s);
    }
  }
  const assistantMarkdown = parts.join("\n\n").trim();
  return { ok, threadId, assistantMarkdown };
}

export async function runSkipprJson<T>(
  cliPath: string,
  args: string[],
  cwd: string,
  output: vscode.LogOutputChannel,
  spawnEnv: NodeJS.ProcessEnv = process.env
): Promise<SkipprJsonCommandResult<T>> {
  const startedAt = Date.now();
  const [command, ...commandArgs] = buildCliCommand(cliPath, args);
  output.info(`$ ${formatCliCommand(cliPath, args)}`);
  const child = spawn(command, commandArgs, { cwd: cliCommandCwd(cliPath) ?? cwd, env: spawnEnv, shell: false });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    forwardRunTranscriptLine("skippr-json", "json-cli", chunk, "stdout");
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    forwardRunTranscriptLine("skippr-json", "json-cli", chunk, "stderr");
    output.info(chunk.trimEnd());
  });

  return new Promise((resolve) => {
    child.on("error", (error) => {
      output.error(error.message);
      resolve({ code: 1, signal: null, elapsedMs: Date.now() - startedAt, stdout });
    });
    child.on("close", (code, signal) => {
      if (code !== 0 && stdout.trim()) {
        output.info(stdout.trimEnd());
      }
      if (stderr.trim() && code !== 0) {
        output.error(stderr.trimEnd());
      }
      let value: T | undefined;
      if (stdout.trim()) {
        try {
          value = JSON.parse(stdout) as T;
        } catch (error) {
          output.error(`Failed to parse Skippr JSON output: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      resolve({ code, signal, elapsedMs: Date.now() - startedAt, value, stdout });
    });
  });
}

export function startSkipprRun(options: SkipprRunOptions, callbacks: SkipprRunnerCallbacks): SkipprProcess {
  const command = options.cliPath || "skippr";
  const args = buildRunArgs(options);
  const [spawnCommand, ...spawnArgs] = buildCliCommand(command, args);
  const label = labelForRun(options);
  const startedAt = Date.now();
  let lastEvent: SkipprRunEvent | undefined;
  let stdoutBuffer = "";
  let stderrBuffer = "";

  callbacks.onLog(`$ ${formatCliCommand(command, args)}`);
  const child = spawn(spawnCommand, spawnArgs, {
    cwd: cliCommandCwd(command) ?? options.cwd,
    env: options.spawnEnv ?? process.env,
    shell: false
  });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer = consumeLines(stdoutBuffer + chunk, (line) => {
      forwardRunTranscriptLine(label, options.kind, line, "stdout");
      const event = parseRunEvent(line);
      if (event) {
        lastEvent = event;
        callbacks.onEvent(event);
      } else if (line.trim()) {
        callbacks.onLog(line);
      }
    });
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrBuffer = consumeLines(stderrBuffer + chunk, (line) => {
      forwardRunTranscriptLine(label, options.kind, line, "stderr");
      callbacks.onLog(line);
    });
  });

  const done = new Promise<SkipprRunResult>((resolve) => {
    child.on("error", (error) => {
      callbacks.onLog(`Failed to start Skippr CLI: ${error.message}`);
      resolve({ code: 1, signal: null, elapsedMs: Date.now() - startedAt, lastEvent });
    });
    child.on("close", (code, signal) => {
      flushRemainder(stdoutBuffer, (line) => {
        forwardRunTranscriptLine(label, options.kind, line, "stdout");
        const event = parseRunEvent(line);
        if (event) {
          lastEvent = event;
          callbacks.onEvent(event);
        } else if (line.trim()) {
          callbacks.onLog(line);
        }
      });
      flushRemainder(stderrBuffer, (line) => {
        forwardRunTranscriptLine(label, options.kind, line, "stderr");
        callbacks.onLog(line);
      });
      resolve({ code, signal, elapsedMs: Date.now() - startedAt, lastEvent });
    });
  });

  return {
    kind: options.kind,
    label,
    done,
    stop: () => {
      if (!child.killed) {
        child.kill();
      }
    }
  };
}

export function buildCliCommand(cliPath: string, args: string[]): string[] {
  if (cliPath !== localCargoCli) {
    return [cliPath, ...args];
  }
  const manifestPath = resolveLocalSkipprdManifest();
  if (!manifestPath) {
    return ["skippr", ...args];
  }
  return ["cargo", "run", "--manifest-path", manifestPath, "-p", "skippr-cli", "--", ...args];
}

export function cliCommandCwd(cliPath: string): string | undefined {
  const manifestPath = cliPath === localCargoCli ? resolveLocalSkipprdManifest() : undefined;
  return manifestPath ? path.dirname(manifestPath) : undefined;
}

export function formatCliCommand(cliPath: string, args: string[]): string {
  return buildCliCommand(cliPath, args).join(" ");
}

function resolveLocalSkipprdManifest(): string | undefined {
  const candidates = [
    process.env.SKIPPRD_MANIFEST_PATH,
    ...localSkipprdManifestCandidates()
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));
  return candidates.find((candidate) => existsSync(candidate));
}

function localSkipprdManifestCandidates(): string[] {
  const workspaceCandidates = (vscode.workspace.workspaceFolders ?? []).flatMap((folder) => [
    path.join(folder.uri.fsPath, "Cargo.toml"),
    path.join(path.dirname(folder.uri.fsPath), "skipprd", "Cargo.toml")
  ]);
  return [
    ...workspaceCandidates,
    path.resolve(__dirname, "../../../../../skipprd/Cargo.toml"),
    path.resolve(__dirname, "../../../../../../skipprd/Cargo.toml")
  ];
}

export function isSkipprRunKind(value: unknown): value is SkipprRunKind {
  return value === "discover" || value === "sync-once" || value === "sync-all-once" || value === "sync" || value === "model";
}

function buildRunArgs(options: SkipprRunOptions): string[] {
  const args: string[] = [];
  if (options.configPath) {
    args.push("--config", options.configPath);
  }
  if (options.logLevel.trim()) {
    args.push("--log", options.logLevel.trim());
  }

  if (options.kind === "discover") {
    args.push("discover");
    if (options.pipeline) {
      args.push("--pipeline", options.pipeline);
    }
    const raw = (options.discoverOutput ?? "json").trim().toLowerCase();
    const out = raw === "progress" || raw === "json" || raw === "text" ? raw : "json";
    args.push("--output", out);
  } else if (options.kind === "model") {
    args.push("model");
    if (options.pipeline) {
      args.push("--pipeline", options.pipeline);
    }
    if (options.modelNoResume) {
      args.push("--no-resume");
    }
    args.push("--output", "jsonl");
  } else {
    args.push("sync");
    if (options.pipeline) {
      args.push("--pipeline", options.pipeline);
    }
    if (options.kind === "sync-once" || options.kind === "sync-all-once") {
      args.push("--once");
    }
    args.push("--output", "json");
  }
  if (options.extraArgs?.length) {
    args.push(...options.extraArgs);
  }
  return args;
}

function labelForRun(options: SkipprRunOptions): string {
  if (options.kind === "discover") {
    return `Discover ${options.pipeline ?? "pipeline"}`;
  }
  if (options.kind === "model") {
    return `Model ${options.pipeline ?? "pipeline"}`;
  }
  if (options.kind === "sync-all-once") {
    return "Sync all once";
  }
  if (options.kind === "sync-once") {
    return `Sync ${options.pipeline ?? "pipeline"} once`;
  }
  return `Sync ${options.pipeline ?? "pipeline"}`;
}

function parseRunEvent(line: string): SkipprRunEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as Partial<SkipprRunEvent>;
    return typeof parsed.event === "string" ? (parsed as SkipprRunEvent) : undefined;
  } catch {
    return undefined;
  }
}

function consumeLines(buffer: string, onLine: (line: string) => void): string {
  const lines = buffer.split(/\r?\n/);
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    onLine(line);
  }
  return remainder;
}

function flushRemainder(buffer: string, onLine: (line: string) => void): void {
  if (buffer.trim()) {
    onLine(buffer);
  }
}

function runShellCommand(command: string, output: vscode.LogOutputChannel): Promise<SkipprRunResult> {
  const shell = os.platform() === "win32" ? "cmd" : "sh";
  const args = os.platform() === "win32" ? ["/c", command] : ["-lc", command];
  return runCommand([shell, ...args], output);
}

function runCommand(
  commandAndArgs: string[],
  output: vscode.LogOutputChannel,
  cwd?: string,
  spawnEnv: NodeJS.ProcessEnv = process.env
): Promise<SkipprRunResult> {
  const [command, ...args] = commandAndArgs;
  const startedAt = Date.now();
  output.info(`$ ${command} ${args.join(" ")}`);
  const child = spawn(command, args, cwd ? { cwd, env: spawnEnv } : { env: spawnEnv });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    forwardRunTranscriptLine(`${command}`, "shell", chunk, "stdout");
    output.info(chunk.trimEnd());
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    forwardRunTranscriptLine(`${command}`, "shell", chunk, "stderr");
    output.error(chunk.trimEnd());
  });

  return new Promise((resolve) => {
    child.on("error", (error) => {
      output.error(error.message);
      resolve({ code: 1, signal: null, elapsedMs: Date.now() - startedAt });
    });
    child.on("close", (code, signal) => {
      resolve({ code, signal, elapsedMs: Date.now() - startedAt });
    });
  });
}
