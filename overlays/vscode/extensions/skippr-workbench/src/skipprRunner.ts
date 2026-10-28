import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { getCloudProjectRootForConfig, getCloudWorkbenchContext } from "./skipprCloudWorkspace";
import * as vscode from "vscode";
import { runKindLabel } from "./skipprRunKinds";
import {
  INSTALL_SDE_ARGV,
  PRODUCT_CLI,
  UPGRADE_SDE_ARGV,
  buildLocalSdeCargoCommand,
  buildSdeRunArgs,
  installedProductCliCandidates,
  type SkipprRunKind,
  type SkipprRunOptions
} from "./skipprSdeArgv";
import { SkipprRunEvent } from "./types";

export {
  LOCAL_CARGO_PACKAGE,
  PRODUCT_CLI,
  installedProductCliCandidates,
  pipelineName,
  type PipelineName,
  type PipelineScopedRunKind,
  type SkipprRunKind,
  type SkipprRunOptions
} from "./skipprSdeArgv";

const transcriptLineMaxChars = 20_000;
const outputLineMaxChars = 12_000;
const ansiEscapePattern = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function forwardRunTranscriptLine(
  label: string,
  kind: string,
  line: string,
  stream: "stdout" | "stderr"
): void {
  const trimmed = compactTranscriptLine(line.trimEnd());
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

export interface SkipprRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  elapsedMs: number;
  lastEvent?: SkipprRunEvent;
  errorDetail?: string;
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

const localCargoCli = "__skippr_local_cargo__";

export function isLocalCargoCli(cliPath: string): boolean {
  return cliPath === localCargoCli;
}

export function useLocalSdeFromSettings(): boolean {
  return (
    vscode.workspace.getConfiguration().get<boolean>("skippr.dev.useLocalSde", true) ||
    process.env.SKIPPR_USE_LOCAL_SDE === "1"
  );
}

export function findInstalledSde(): string | undefined {
  const candidates = installedProductCliCandidates();
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  try {
    const resolved = execFileSync("which", [PRODUCT_CLI], { encoding: "utf8" }).trim();
    if (resolved && existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // not on PATH
  }
  return undefined;
}

function enrichCargoFailureDetail(detail: string | undefined, stderrHint?: string): string | undefined {
  const combined = [detail, stderrHint].filter((part): part is string => Boolean(part?.trim())).join("\n");
  return combined.trim() ? combined : detail;
}

export async function resolveSde(configuredPath: string | undefined): Promise<string | undefined> {
  const trimmed = configuredPath?.trim();
  if (trimmed) {
    return trimmed;
  }

  const manifest = resolveLocalSdeManifest();
  if (manifest && useLocalSdeFromSettings()) {
    return localCargoCli;
  }
  return findInstalledSde();
}

export async function installSde(output: vscode.LogOutputChannel): Promise<SkipprRunResult> {
  output.show(true);
  output.info(`Installing ${PRODUCT_CLI} with Homebrew (${INSTALL_SDE_ARGV.join(" ")}).`);
  return runCommand([...INSTALL_SDE_ARGV], output);
}

export async function updateSde(
  _cliPath: string | undefined,
  output: vscode.LogOutputChannel,
  spawnEnv: NodeJS.ProcessEnv = process.env
): Promise<SkipprRunResult> {
  output.show(true);
  output.info(`Updating ${PRODUCT_CLI} with Homebrew (${UPGRADE_SDE_ARGV.join(" ")}).`);
  return runCommand([...UPGRADE_SDE_ARGV], output, undefined, spawnEnv);
}

export async function showSkipprVersion(
  cliPath: string,
  output: vscode.LogOutputChannel,
  spawnEnv: NodeJS.ProcessEnv = process.env
): Promise<SkipprRunResult> {
  output.show(true);
  output.info(`Checking Skippr CLI version: ${formatCliCommand(cliPath, ["--version"])}`);
  return runCommand(buildCliCommand(cliPath, ["--version"]), output, undefined, spawnEnv);
}

export async function runSkipprJson<T>(
  cliPath: string,
  args: string[],
  cwd: string,
  output: vscode.LogOutputChannel,
  spawnEnv: NodeJS.ProcessEnv = process.env,
  configPath?: string
): Promise<SkipprJsonCommandResult<T>> {
  const startedAt = Date.now();
  const projectCwd = skipprProjectRoot(configPath, cwd);
  const [command, ...commandArgs] = buildCliCommand(cliPath, args);
  output.info(`$ ${formatSkipprInvocation(cliPath, args, projectCwd)}`);
  const child = spawn(command, commandArgs, { cwd: projectCwd, env: spawnEnv, shell: false });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    const clean = stripAnsi(chunk);
    stdout += clean;
    forwardRunTranscriptLine("skippr-json", "json-cli", clean, "stdout");
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    const clean = stripAnsi(chunk);
    stderr += clean;
    forwardRunTranscriptLine("skippr-json", "json-cli", clean, "stderr");
    const line = compactOutputLine(clean.trimEnd());
    if (line) {
      output.info(line);
    }
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
        const line = compactOutputLine(stderr.trimEnd());
        if (line) {
          output.error(line);
        }
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
  const command = options.cliPath || PRODUCT_CLI;
  const args = buildRunArgs(options);
  const [spawnCommand, ...spawnArgs] = buildCliCommand(command, args);
  const label = labelForRun(options);
  const startedAt = Date.now();
  let lastEvent: SkipprRunEvent | undefined;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let lastErrorLine: string | undefined;

  const projectCwd = skipprProjectRoot(options.configPath, options.cwd);
  callbacks.onLog(`$ ${formatSkipprInvocation(command, args, projectCwd)}`);
  const child = spawn(spawnCommand, spawnArgs, {
    cwd: projectCwd,
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
        const compacted = compactOutputLine(line);
        if (compacted) {
          callbacks.onLog(compacted);
        }
      }
    });
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrBuffer = consumeLines(stderrBuffer + stripAnsi(chunk), (line) => {
      forwardRunTranscriptLine(label, options.kind, line, "stderr");
      if (line.trim()) {
        lastErrorLine = line.trim();
      }
      const compacted = compactOutputLine(line);
      if (compacted) {
        callbacks.onLog(compacted);
      }
    });
  });

  const done = new Promise<SkipprRunResult>((resolve) => {
    child.on("error", (error) => {
      callbacks.onLog(`Failed to start Skippr CLI: ${error.message}`);
      resolve({ code: 1, signal: null, elapsedMs: Date.now() - startedAt, lastEvent, errorDetail: error.message });
    });
    child.on("close", (code, signal) => {
      flushRemainder(stdoutBuffer, (line) => {
        forwardRunTranscriptLine(label, options.kind, line, "stdout");
        const event = parseRunEvent(line);
        if (event) {
          lastEvent = event;
          callbacks.onEvent(event);
        } else if (line.trim()) {
          const compacted = compactOutputLine(line);
          if (compacted) {
            callbacks.onLog(compacted);
          }
        }
      });
      flushRemainder(stderrBuffer, (line) => {
        forwardRunTranscriptLine(label, options.kind, line, "stderr");
        if (line.trim()) {
          lastErrorLine = line.trim();
        }
        const compacted = compactOutputLine(line);
        if (compacted) {
          callbacks.onLog(compacted);
        }
      });
      resolve({
        code,
        signal,
        elapsedMs: Date.now() - startedAt,
        lastEvent,
        errorDetail:
          code === 0
            ? undefined
            : enrichCargoFailureDetail(lastEvent?.error ?? lastEvent?.failure_summary ?? lastErrorLine, stderrBuffer)
      });
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
  const manifestPath = resolveLocalSdeManifest();
  if (!manifestPath) {
    return [PRODUCT_CLI, ...args];
  }
  return buildLocalSdeCargoCommand(manifestPath, args);
}

/** Directory containing skippr.yml (absolute). Used as the child process cwd for every CLI invocation. */
export function skipprProjectRoot(
  configPath: string | undefined,
  fallbackCwd: string,
  cloudProjectRoot?: string
): string {
  const ctx = getCloudWorkbenchContext();
  const resolvedCloud =
    cloudProjectRoot?.trim() ||
    (ctx ? getCloudProjectRootForConfig(ctx, configPath) : undefined);
  if (resolvedCloud?.trim()) {
    return path.resolve(resolvedCloud);
  }
  const trimmed = configPath?.trim();
  if (trimmed) {
    return path.resolve(path.dirname(trimmed));
  }
  const configured = vscode.workspace.getConfiguration().get<string>("skippr.run.cwd", "").trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(fallbackCwd);
}

export function formatSkipprInvocation(cliPath: string, args: string[], cwd: string): string {
  return `(cwd: ${cwd}) ${formatCliCommand(cliPath, args)}`;
}

export function configPathFromCliArgs(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]?.trim()) {
      return args[i + 1].trim();
    }
  }
  return undefined;
}

export function formatCliCommand(cliPath: string, args: string[]): string {
  return buildCliCommand(cliPath, args).join(" ");
}

export function resolveLocalSkipprdManifest(): string | undefined {
  const candidates = [
    process.env.SKIPPRD_MANIFEST_PATH,
    ...localSkipprdManifestCandidates()
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));
  return candidates.find((candidate) => existsSync(candidate));
}

/** Root of the local skipprd checkout (parent of workspace `Cargo.toml`). */
export function resolveSkipprdRepoRoot(): string | undefined {
  const manifest = resolveLocalSkipprdManifest();
  return manifest ? path.dirname(manifest) : undefined;
}

function localSkipprdManifestCandidates(): string[] {
  const settingsRoot = vscode.workspace.getConfiguration().get<string>("skippr.dev.skipprdRoot", "").trim();
  const configured = process.env.SKIPPRD_ROOT?.trim() || settingsRoot;
  if (configured) {
    return [path.resolve(configured, "Cargo.toml")];
  }
  const workspaceCandidates = (vscode.workspace.workspaceFolders ?? []).flatMap((folder) => [
    path.join(folder.uri.fsPath, "Cargo.toml"),
    path.join(folder.uri.fsPath, "skipprd", "Cargo.toml"),
    path.join(path.dirname(folder.uri.fsPath), "skipprd", "Cargo.toml")
  ]);
  return [
    ...workspaceCandidates,
    path.resolve(__dirname, "../../../../../skipprd/Cargo.toml"),
    path.resolve(__dirname, "../../../../../../skipprd/Cargo.toml")
  ];
}

export function resolveLocalSdeManifest(): string | undefined {
  const candidates = [
    process.env.SKIPPR_SDE_MANIFEST_PATH,
    ...localSdeManifestCandidates()
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));
  return candidates.find((candidate) => existsSync(candidate));
}

function localSdeManifestCandidates(): string[] {
  const settingsRoot = vscode.workspace.getConfiguration().get<string>("skippr.dev.sdeRoot", "").trim();
  const configured = process.env.SKIPPR_SDE_ROOT?.trim() || settingsRoot;
  if (configured) {
    return [path.resolve(configured, "Cargo.toml")];
  }
  const skipprdRoot = resolveSkipprdRepoRoot();
  const workspaceCandidates = (vscode.workspace.workspaceFolders ?? []).flatMap((folder) => [
    path.join(folder.uri.fsPath, "Cargo.toml"),
    path.join(folder.uri.fsPath, "sde", "Cargo.toml"),
    path.join(path.dirname(folder.uri.fsPath), "sde", "Cargo.toml")
  ]);
  return [
    ...workspaceCandidates,
    ...(skipprdRoot ? [path.resolve(skipprdRoot, "../sde/Cargo.toml")] : []),
    path.resolve(__dirname, "../../../../../sde/Cargo.toml"),
    path.resolve(__dirname, "../../../../../../sde/Cargo.toml")
  ];
}

export function isSkipprRunKind(value: unknown): value is SkipprRunKind {
  return (
    value === "discover" ||
    value === "sync-once" ||
    value === "sync-all-once" ||
    value === "sync" ||
    value === "model"
  );
}

export function buildRunArgs(options: SkipprRunOptions): string[] {
  return buildSdeRunArgs(options, skipprProjectRoot(options.configPath, options.cwd));
}

function labelForRun(options: SkipprRunOptions): string {
  const kind = runKindLabel(options.kind);
  if (options.kind === "sync-all-once") {
    return kind;
  }
  return `${kind} ${options.pipeline}`;
}

function compactTranscriptLine(line: string): string {
  return clipText(scrubLargeEmbeddedData(stripAnsi(line)), transcriptLineMaxChars);
}

function compactOutputLine(line: string): string | undefined {
  const scrubbed = scrubLargeEmbeddedData(stripAnsi(line.trimEnd()));
  const summary = summarizeJsonLine(scrubbed);
  if (summary === null) {
    return undefined;
  }
  return clipText(summary ?? scrubbed, outputLineMaxChars);
}

function stripAnsi(text: string): string {
  return text.replace(ansiEscapePattern, "");
}

function summarizeJsonLine(line: string): string | undefined | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const type = typeof parsed.type === "string" ? parsed.type : undefined;
    const event = typeof parsed.event === "string" ? parsed.event : undefined;
    if (type === "thread_state") {
      return null;
    }
    if (trimmed.length <= outputLineMaxChars) {
      return undefined;
    }
    if (type === "tool_end") {
      const name = typeof parsed.name === "string" ? parsed.name : "tool";
      const status = typeof parsed.status === "string" ? parsed.status : "unknown";
      const error = typeof parsed.error === "string" ? ` error=${clipText(parsed.error, 500)}` : "";
      return `[skippr-json] tool_end ${name} status=${status}${error} (${trimmed.length} chars elided)`;
    }
    if (type || event) {
      return `[skippr-json] ${type ?? event} (${trimmed.length} chars elided)`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function scrubLargeEmbeddedData(text: string): string {
  return text.replace(/data:[^"'\\\s]+;base64,[A-Za-z0-9+/=]+/g, "[base64 data elided]");
}

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}... [truncated ${text.length - maxChars} chars]`;
}

function parseRunEvent(line: string): SkipprRunEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as Partial<SkipprRunEvent> & { type?: unknown; ts?: unknown; server_time?: unknown };
    if (typeof parsed.event === "string") {
      return parsed as SkipprRunEvent;
    }
    if (parsed.event_kind === "tool_start" || parsed.event_kind === "tool_end") {
      return { ...parsed, event: parsed.event_kind } as SkipprRunEvent;
    }
    if (parsed.type === "tool_start" || parsed.type === "tool_end") {
      return {
        ...parsed,
        event: parsed.type,
        timestamp: typeof parsed.server_time === "string" ? parsed.server_time : parsed.timestamp
      } as SkipprRunEvent;
    }
    if (parsed.type === "phase" && typeof parsed.phase === "string") {
      return {
        ...parsed,
        event: "model_phase_changed",
        run_kind: "model",
        timestamp: typeof parsed.ts === "string" ? parsed.ts : typeof parsed.server_time === "string" ? parsed.server_time : parsed.timestamp
      } as SkipprRunEvent;
    }
    return undefined;
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
    const clean = stripAnsi(chunk);
    forwardRunTranscriptLine(`${command}`, "shell", clean, "stdout");
    const line = compactOutputLine(clean.trimEnd());
    if (line) {
      output.info(line);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    const clean = stripAnsi(chunk);
    forwardRunTranscriptLine(`${command}`, "shell", clean, "stderr");
    const line = compactOutputLine(clean.trimEnd());
    if (line) {
      output.error(line);
    }
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
