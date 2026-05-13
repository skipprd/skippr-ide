import { spawn } from "node:child_process";
import * as os from "node:os";
import * as vscode from "vscode";
import { SkipprRunEvent } from "./types";

export type SkipprRunKind = "discover" | "sync-once" | "sync-all-once" | "sync";

export interface SkipprRunOptions {
  kind: SkipprRunKind;
  cliPath?: string;
  cwd: string;
  pipeline?: string;
  logLevel: string;
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

const installerCommand = "curl -fsSL https://install.skippr.io/install.sh | sh -";

export async function resolveSkipprCli(configuredPath: string | undefined): Promise<string | undefined> {
  const trimmed = configuredPath?.trim();
  if (trimmed) {
    return trimmed;
  }

  const discovered = await runShellCapture("command -v skippr || command -v skipprd");
  return discovered.trim() || undefined;
}

export async function installSkipprCli(output: vscode.LogOutputChannel): Promise<SkipprRunResult> {
  output.show(true);
  output.info(`Installing Skippr CLI with: ${installerCommand}`);
  return runShellCommand(installerCommand, output);
}

export async function updateSkipprCli(cliPath: string | undefined, output: vscode.LogOutputChannel): Promise<SkipprRunResult> {
  output.show(true);
  if (cliPath) {
    const update = await runCommand([cliPath, "update"], output);
    if (update.code === 0) {
      return update;
    }
    output.warn("`skippr update` failed or is not supported; falling back to installer.");
  }
  output.info(`Updating Skippr CLI with: ${installerCommand}`);
  return runShellCommand(installerCommand, output);
}

export async function showSkipprVersion(cliPath: string, output: vscode.LogOutputChannel): Promise<SkipprRunResult> {
  output.show(true);
  output.info(`Checking Skippr CLI version: ${cliPath} --version`);
  return runCommand([cliPath, "--version"], output);
}

export function startSkipprRun(options: SkipprRunOptions, callbacks: SkipprRunnerCallbacks): SkipprProcess {
  const command = options.cliPath || "skippr";
  const args = buildRunArgs(options);
  const label = labelForRun(options);
  const startedAt = Date.now();
  let lastEvent: SkipprRunEvent | undefined;
  let stdoutBuffer = "";
  let stderrBuffer = "";

  callbacks.onLog(`$ ${command} ${args.join(" ")}`);
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: process.env,
    shell: false
  });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer = consumeLines(stdoutBuffer + chunk, (line) => {
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
    stderrBuffer = consumeLines(stderrBuffer + chunk, callbacks.onLog);
  });

  const done = new Promise<SkipprRunResult>((resolve) => {
    child.on("error", (error) => {
      callbacks.onLog(`Failed to start Skippr CLI: ${error.message}`);
      resolve({ code: 1, signal: null, elapsedMs: Date.now() - startedAt, lastEvent });
    });
    child.on("close", (code, signal) => {
      flushRemainder(stdoutBuffer, (line) => {
        const event = parseRunEvent(line);
        if (event) {
          lastEvent = event;
          callbacks.onEvent(event);
        } else if (line.trim()) {
          callbacks.onLog(line);
        }
      });
      flushRemainder(stderrBuffer, callbacks.onLog);
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

export function isSkipprRunKind(value: unknown): value is SkipprRunKind {
  return value === "discover" || value === "sync-once" || value === "sync-all-once" || value === "sync";
}

function buildRunArgs(options: SkipprRunOptions): string[] {
  const args: string[] = [];
  if (options.logLevel.trim()) {
    args.push("--log", options.logLevel.trim());
  }

  if (options.kind === "discover") {
    args.push("discover");
    if (options.pipeline) {
      args.push("--pipeline", options.pipeline);
    }
  } else {
    args.push("sync");
    if (options.pipeline) {
      args.push("--pipeline", options.pipeline);
    }
    if (options.kind === "sync-once" || options.kind === "sync-all-once") {
      args.push("--once");
    }
  }

  args.push("--output", "json");
  return args;
}

function labelForRun(options: SkipprRunOptions): string {
  if (options.kind === "discover") {
    return `Discover ${options.pipeline ?? "pipeline"}`;
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

function runShellCapture(command: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(os.platform() === "win32" ? "cmd" : "sh", os.platform() === "win32" ? ["/c", command] : ["-lc", command]);
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(stdout));
  });
}

function runShellCommand(command: string, output: vscode.LogOutputChannel): Promise<SkipprRunResult> {
  const shell = os.platform() === "win32" ? "cmd" : "sh";
  const args = os.platform() === "win32" ? ["/c", command] : ["-lc", command];
  return runCommand([shell, ...args], output);
}

function runCommand(commandAndArgs: string[], output: vscode.LogOutputChannel): Promise<SkipprRunResult> {
  const [command, ...args] = commandAndArgs;
  const startedAt = Date.now();
  output.info(`$ ${command} ${args.join(" ")}`);
  const child = spawn(command, args);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => output.info(chunk.trimEnd()));
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => output.error(chunk.trimEnd()));

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
