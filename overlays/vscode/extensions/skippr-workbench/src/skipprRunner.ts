import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getCloudProjectRootForConfig, getCloudWorkbenchContext } from "./skipprCloudWorkspace";
import * as vscode from "vscode";
import { SkipprRunEvent } from "./types";

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

export type SkipprRunKind = "discover" | "sync-once" | "sync-all-once" | "sync" | "model";
export type PipelineScopedRunKind = Exclude<SkipprRunKind, "sync-all-once">;
export type PipelineName = string & { readonly __skipprPipelineName: unique symbol };

export function pipelineName(value: string): PipelineName | undefined {
  const trimmed = value.trim();
  return trimmed ? (trimmed as PipelineName) : undefined;
}

interface BaseSkipprRunOptions {
  cliPath?: string;
  cwd: string;
  configPath: string;
  logLevel: string;
  /** Appended after built flags (e.g. from the Run panel “Args” field). */
  extraArgs?: string[];
  /** When set, used as the child process environment (typically `process.env` merged with Skippr settings). */
  spawnEnv?: NodeJS.ProcessEnv;
}

export type SkipprRunOptions =
  | (BaseSkipprRunOptions & {
      kind: PipelineScopedRunKind;
      pipeline: PipelineName;
      /** `skippr discover --output` (CLI: progress | json | text). */
      discoverOutput?: string;
      /** When true, pass `skippr model --no-resume`. */
      modelNoResume?: boolean;
      modelGoal?: string;
      modelScope?: string;
      modelTargetModels?: string;
      modelArtifacts?: string;
    })
  | (BaseSkipprRunOptions & {
      kind: "sync-all-once";
    });

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

const installerCommand = "curl -fsSL https://install.skippr.io/install.sh | sh -";
const localCargoCli = "__skippr_local_cargo__";
const REACT_CARGO_REGISTRY_INDEX = "sparse+https://skippr-132355036174.d.codeartifact.us-east-1.amazonaws.com/cargo/react-cargo/";

/** Crates published to react-cargo that skipprd resolves from path when ../react exists. */
const REACT_CARGO_PATCHES: ReadonlyArray<readonly [string, string]> = [
  ["react", "src/runtime"],
  ["react-core", "src/core"],
  ["react-http-protocol", "src/http-protocol"],
  ["react-transport", "src/transport"],
  ["react-view", "src/view"],
  ["react-module-storage-s3", "src/modules/adaptors/storage-s3"],
  ["react-module-storage-local", "src/modules/adaptors/storage-local"],
  ["react-module-storage-memory", "src/modules/adaptors/storage-memory"],
  ["react-module-provider-vector-lance", "src/modules/providers/vector-lance"],
  ["react-suite-debugger", "src/suites/suite_debugger"]
];

export function isLocalCargoCli(cliPath: string): boolean {
  return cliPath === localCargoCli;
}

export function useLocalSkipprdFromSettings(): boolean {
  return (
    vscode.workspace.getConfiguration().get<boolean>("skippr.dev.useLocalSkipprd", true) ||
    process.env.SKIPPR_USE_LOCAL_SKIPPRD === "1"
  );
}

export function findInstalledSkipprCli(): string | undefined {
  const candidates = [
    path.join(os.homedir(), ".skippr", "bin", "skippr"),
    "/usr/local/bin/skippr",
    "/opt/homebrew/bin/skippr"
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  try {
    const resolved = execFileSync("which", ["skippr"], { encoding: "utf8" }).trim();
    if (resolved && existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // not on PATH
  }
  return undefined;
}

function localReactRootFromSkipprdManifest(manifestPath: string): string | undefined {
  const settingsRoot = vscode.workspace.getConfiguration().get<string>("skippr.dev.reactRoot", "").trim();
  const configured = process.env.SKIPPR_REACT_ROOT?.trim() || settingsRoot;
  if (configured && existsSync(path.join(configured, "Cargo.toml"))) {
    return path.resolve(configured);
  }
  const skipprdRoot = path.dirname(manifestPath);
  const candidates = [
    ...((vscode.workspace.workspaceFolders ?? [])
      .filter((folder) => folder.name === "react" || folder.uri.fsPath.endsWith(`${path.sep}react`))
      .map((folder) => folder.uri.fsPath)),
    path.resolve(skipprdRoot, "../react"),
    path.resolve(skipprdRoot, "../../react")
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "Cargo.toml"))) {
      return candidate;
    }
  }
  return undefined;
}

function reactCargoPatchConfigArgs(manifestPath: string): string[] {
  const reactRoot = localReactRootFromSkipprdManifest(manifestPath);
  const args = ["--config", `registries.react-cargo.index="${REACT_CARGO_REGISTRY_INDEX}"`];
  if (!reactRoot) {
    return args;
  }
  for (const [crateName, relativePath] of REACT_CARGO_PATCHES) {
    args.push("--config", `patch."react-cargo".${crateName}.path="${path.resolve(reactRoot, relativePath)}"`);
  }
  return args;
}

export function reactCargoAuthHint(): string {
  return (
    "Skippr could not fetch React crates from the private react-cargo registry. " +
    "Place a sibling ../react checkout next to skipprd (or set SKIPPR_REACT_ROOT), run " +
    "the local dev CLI through cargo, install the release CLI (Skippr: Install CLI), " +
    "or export CARGO_REGISTRIES_REACT_CARGO_TOKEN (see skipprd/docs/docs/maintainers/local-development.md)."
  );
}

function enrichCargoFailureDetail(detail: string | undefined, stderrHint?: string): string | undefined {
  const combined = [detail, stderrHint].filter((part): part is string => Boolean(part?.trim())).join("\n");
  if (!combined.includes("react-cargo")) {
    return detail;
  }
  return `${combined}\n${reactCargoAuthHint()}`;
}

export async function resolveSkipprCli(configuredPath: string | undefined): Promise<string | undefined> {
  const trimmed = configuredPath?.trim();
  if (trimmed) {
    return trimmed;
  }

  const manifest = resolveLocalSkipprdManifest();
  if (manifest && useLocalSkipprdFromSettings()) {
    return localCargoCli;
  }
  return findInstalledSkipprCli();
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
    const update = await runCommand(buildCliCommand(cliPath, ["update"]), output, undefined, spawnEnv);
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
  const command = options.cliPath || "skippr";
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
  const manifestPath = resolveLocalSkipprdManifest();
  if (!manifestPath) {
    return ["skippr", ...args];
  }
  const patchArgs = reactCargoPatchConfigArgs(manifestPath);
  return [
    "cargo",
    "run",
    "--manifest-path",
    manifestPath,
    ...patchArgs,
    "-p",
    "skippr-cli",
    "--",
    ...args
  ];
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
  const args: string[] = [];
  args.push("--config", options.configPath);
  if (options.logLevel.trim()) {
    args.push("--log", options.logLevel.trim());
  }

  if (options.kind === "discover") {
    args.push("discover");
    args.push("--pipeline", options.pipeline);
    const raw = (options.discoverOutput ?? "json").trim().toLowerCase();
    const out = raw === "progress" || raw === "json" || raw === "text" ? raw : "json";
    args.push("--output", out);
  } else if (options.kind === "model") {
    args.push("model");
    args.push("--pipeline", options.pipeline);
    args.push("--dbt-output-path", modelDbtOutputPath(options));
    if (options.modelNoResume) {
      args.push("--no-resume");
    }
    if (options.modelGoal?.trim()) {
      args.push("--goal", options.modelGoal.trim());
    }
    if (options.modelScope?.trim()) {
      args.push("--scope", options.modelScope.trim());
    }
    if (options.modelTargetModels?.trim()) {
      args.push("--target-models", options.modelTargetModels.trim());
    }
    if (options.modelArtifacts?.trim()) {
      args.push("--artifacts", options.modelArtifacts.trim());
    }
    args.push("--output", "jsonl");
  } else if (options.kind === "sync-all-once") {
    args.push("sync", "--once", "--output", "json");
  } else {
    args.push("sync");
    args.push("--pipeline", options.pipeline);
    if (options.kind === "sync-once") {
      args.push("--once");
    }
    args.push("--output", "json");
  }
  if (options.extraArgs?.length) {
    args.push(...options.extraArgs);
  }
  return args;
}

function modelDbtOutputPath(options: SkipprRunOptions): string {
  if (options.kind !== "model") {
    return path.join(skipprProjectRoot(options.configPath, options.cwd), "dbt");
  }
  return path.join(skipprProjectRoot(options.configPath, options.cwd), options.pipeline, "dbt");
}

function labelForRun(options: SkipprRunOptions): string {
  if (options.kind === "discover") {
    return `Discover ${options.pipeline}`;
  }
  if (options.kind === "model") {
    return `Model ${options.pipeline}`;
  }
  if (options.kind === "sync-all-once") {
    return "Sync all once";
  }
  if (options.kind === "sync-once") {
    return `Sync ${options.pipeline} once`;
  }
  return `Sync ${options.pipeline}`;
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
