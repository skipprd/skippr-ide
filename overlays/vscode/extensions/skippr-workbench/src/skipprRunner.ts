import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { SkipprRunEvent } from "./types";

const transcriptLineMaxChars = 20_000;
const outputLineMaxChars = 12_000;

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

export type SkipprRunKind = "discover" | "sync-once" | "sync-all-once" | "sync" | "model" | "model-direct";

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
const reactCargoRegistryIndex =
  "sparse+https://skippr-132355036174.d.codeartifact.us-east-1.amazonaws.com/cargo/react-cargo/";
const directDiffBeforeScheme = "skippr-direct-before";

const directDiffBeforeDocs = new Map<string, string>();
let directDiffProviderRegistered = false;

function ensureDirectDiffProvider(): void {
  if (directDiffProviderRegistered) {
    return;
  }
  directDiffProviderRegistered = true;
  vscode.workspace.registerTextDocumentContentProvider(directDiffBeforeScheme, {
    provideTextDocumentContent(uri) {
      return directDiffBeforeDocs.get(uri.toString()) ?? "";
    }
  });
}

/** Crates published to react-cargo that skipprd resolves from path when ../react exists. */
const REACT_CARGO_PATCHES: ReadonlyArray<readonly [string, string]> = [
  ["react", "../react/src/runtime"],
  ["react-core", "../react/src/core"],
  ["react-http-protocol", "../react/src/http-protocol"],
  ["react-transport", "../react/src/transport"],
  ["react-view", "../react/src/view"],
  ["react-module-storage-s3", "../react/src/modules/adaptors/storage-s3"],
  ["react-module-storage-local", "../react/src/modules/adaptors/storage-local"],
  ["react-module-storage-memory", "../react/src/modules/adaptors/storage-memory"],
  ["react-module-provider-vector-lance", "../react/src/modules/providers/vector-lance"],
  ["react-suite-debugger", "../react/src/suites/suite_debugger"]
];

export function isLocalCargoCli(cliPath: string): boolean {
  return cliPath === localCargoCli;
}

function useLocalSkipprdFromSettings(): boolean {
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
  const skipprdRoot = path.dirname(manifestPath);
  const reactRoot = path.resolve(skipprdRoot, "../react");
  return existsSync(path.join(reactRoot, "Cargo.toml")) ? reactRoot : undefined;
}

function reactCargoPatchConfigArgs(manifestPath: string): string[] {
  const reactRoot = localReactRootFromSkipprdManifest(manifestPath);
  if (!reactRoot) {
    return [];
  }
  const args: string[] = [];
  for (const [crateName, relativePath] of REACT_CARGO_PATCHES) {
    args.push("--config", `patch."react-cargo".${crateName}.path="${path.resolve(reactRoot, relativePath.replace(/^\.\.\/react\//, ""))}"`);
  }
  return args;
}

export function reactCargoAuthHint(): string {
  return (
    "Skippr could not fetch React crates from the private react-cargo registry. " +
    "Install the Skippr CLI (Skippr: Install CLI), turn off skippr.dev.useLocalSkipprd to use an installed release binary, " +
    "place a sibling ../react checkout next to skipprd, or export CARGO_REGISTRIES_REACT_CARGO_TOKEN " +
    "(see skipprd/docs/docs/maintainers/local-development.md)."
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
    stdout += chunk;
    forwardRunTranscriptLine("skippr-json", "json-cli", chunk, "stdout");
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    forwardRunTranscriptLine("skippr-json", "json-cli", chunk, "stderr");
    output.info(compactOutputLine(chunk.trimEnd()));
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
        output.error(compactOutputLine(stderr.trimEnd()));
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
  const directDiffRoot = options.kind === "model-direct" ? directDbtOutputPath(options) : undefined;
  const directDiffBefore = directDiffRoot ? snapshotDirectDiffFiles(directDiffRoot) : undefined;
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
        callbacks.onLog(compactOutputLine(line));
      }
    });
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrBuffer = consumeLines(stderrBuffer + chunk, (line) => {
      forwardRunTranscriptLine(label, options.kind, line, "stderr");
      if (line.trim()) {
        lastErrorLine = line.trim();
      }
      callbacks.onLog(compactOutputLine(line));
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
          callbacks.onLog(compactOutputLine(line));
        }
      });
      flushRemainder(stderrBuffer, (line) => {
        forwardRunTranscriptLine(label, options.kind, line, "stderr");
        if (line.trim()) {
          lastErrorLine = line.trim();
        }
        callbacks.onLog(compactOutputLine(line));
      });
      if (directDiffRoot && directDiffBefore) {
        void showDirectModelDiffs(directDiffRoot, directDiffBefore, options, callbacks);
      }
      resolve({
        code,
        signal,
        elapsedMs: Date.now() - startedAt,
        lastEvent,
        errorDetail:
          code === 0 ? undefined : enrichCargoFailureDetail(lastEvent?.error ?? lastErrorLine, stderrBuffer)
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
  return [
    "cargo",
    "run",
    "--manifest-path",
    manifestPath,
    "--config",
    `registries.react-cargo.index="${reactCargoRegistryIndex}"`,
    ...reactCargoPatchConfigArgs(manifestPath),
    "-p",
    "skippr-cli",
    "--",
    ...args
  ];
}

/** Directory containing skippr.yml (absolute). Used as the child process cwd for every CLI invocation. */
export function skipprProjectRoot(configPath: string | undefined, fallbackCwd: string): string {
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
  return (
    value === "discover" ||
    value === "sync-once" ||
    value === "sync-all-once" ||
    value === "sync" ||
    value === "model" ||
    value === "model-direct"
  );
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
  } else if (options.kind === "model" || options.kind === "model-direct") {
    args.push("model");
    if (options.pipeline) {
      args.push("--pipeline", options.pipeline);
    }
    if (options.kind === "model-direct") {
      args.push("--agent-type", "direct");
      args.push("--dbt-output-path", directDbtOutputPath(options));
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

function directDbtOutputPath(options: SkipprRunOptions): string {
  return path.join(skipprProjectRoot(options.configPath, options.cwd), "dbt", options.pipeline ?? "default");
}

function snapshotDirectDiffFiles(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  if (!existsSync(root)) {
    return snapshot;
  }
  for (const file of walkDirectDiffFiles(root)) {
    try {
      snapshot.set(file, readFileSync(file, "utf8"));
    } catch {
      // Ignore files that disappear or are not valid UTF-8; dbt source files are text.
    }
  }
  return snapshot;
}

function walkDirectDiffFiles(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry === ".git" || entry === "target" || entry === "logs" || entry === "dbt_packages") {
      continue;
    }
    const full = path.join(root, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      files.push(...walkDirectDiffFiles(full));
    } else if (stat.isFile() && isDirectDiffTextFile(full)) {
      files.push(full);
    }
  }
  return files;
}

function isDirectDiffTextFile(file: string): boolean {
  return [".sql", ".yml", ".yaml", ".csv", ".md", ".txt"].includes(path.extname(file).toLowerCase());
}

async function showDirectModelDiffs(
  root: string,
  before: Map<string, string>,
  options: SkipprRunOptions,
  callbacks: SkipprRunnerCallbacks
): Promise<void> {
  const after = snapshotDirectDiffFiles(root);
  const paths = new Set<string>([...before.keys(), ...after.keys()]);
  const changed = [...paths]
    .filter((file) => before.get(file) !== after.get(file))
    .sort((a, b) => path.relative(root, a).localeCompare(path.relative(root, b)));
  if (!changed.length) {
    callbacks.onLog("[skippr] Direct model made no local dbt file changes to diff.");
    return;
  }

  ensureDirectDiffProvider();
  const changedFiles = changed.map((file) => {
    const existedBefore = before.has(file);
    const existsAfter = after.has(file);
    const changeKind: "created" | "modified" | "deleted" = !existedBefore ? "created" : !existsAfter ? "deleted" : "modified";
    return {
      path: path.relative(root, file) || path.basename(file),
      absolute_path: file,
      change_kind: changeKind,
      lines_added: countAddedLines(before.get(file) ?? "", after.get(file) ?? ""),
      lines_removed: countAddedLines(after.get(file) ?? "", before.get(file) ?? "")
    };
  });
  callbacks.onEvent({
    event: "model_file_changed",
    run_kind: options.kind,
    pipeline: options.pipeline,
    timestamp: new Date().toISOString(),
    phase: "review",
    changed_files: changedFiles
  });
  callbacks.onLog(`[skippr] Opening ${changed.length} Direct model change${changed.length === 1 ? "" : "s"}.`);
  const createdCount = changedFiles.filter((file) => file.change_kind === "created").length;
  const modifiedCount = changedFiles.filter((file) => file.change_kind === "modified").length;
  const deletedCount = changedFiles.filter((file) => file.change_kind === "deleted").length;
  const linesAdded = changedFiles.reduce((sum, file) => sum + (file.lines_added ?? 0), 0);
  const linesRemoved = changedFiles.reduce((sum, file) => sum + (file.lines_removed ?? 0), 0);
  const multiDiffChanges: unknown[] = [];
  for (const file of changed.slice(0, 20)) {
    const rel = path.relative(root, file) || path.basename(file);
    const beforeUri = directDiffBeforeUri(file, before.get(file) ?? "");
    const afterUri = after.has(file)
      ? vscode.Uri.file(file)
      : directDiffBeforeUri(`${file}.deleted`, "");
    multiDiffChanges.push([beforeUri, afterUri, rel]);
  }
  try {
    await vscode.commands.executeCommand("vscode.changes", `Skippr Direct: ${options.pipeline ?? "model"} changes`, multiDiffChanges);
    callbacks.onEvent({
      event: "model_review_ready",
      run_kind: options.kind,
      pipeline: options.pipeline,
      timestamp: new Date().toISOString(),
      phase: "review",
      total_count: changedFiles.length,
      created_count: createdCount,
      modified_count: modifiedCount,
      deleted_count: deletedCount,
      lines_added: linesAdded,
      lines_removed: linesRemoved,
      summary: `${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"} ready for review`
    });
  } catch {
    for (const [beforeUri, afterUri, rel] of multiDiffChanges as [vscode.Uri, vscode.Uri, string][]) {
      await vscode.commands.executeCommand(
        "vscode.diff",
        beforeUri,
        afterUri,
        `Skippr Direct: ${rel}`,
        { preview: false }
      );
    }
    callbacks.onEvent({
      event: "model_review_ready",
      run_kind: options.kind,
      pipeline: options.pipeline,
      timestamp: new Date().toISOString(),
      phase: "review",
      total_count: changedFiles.length,
      created_count: createdCount,
      modified_count: modifiedCount,
      deleted_count: deletedCount,
      lines_added: linesAdded,
      lines_removed: linesRemoved,
      summary: `${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"} opened in fallback diff review`
    });
  }
  if (changed.length > 20) {
    callbacks.onLog(`[skippr] ${changed.length - 20} additional Direct model diffs were not opened.`);
  }
}

function countAddedLines(before: string, after: string): number {
  const beforeLines = new Set(before.split(/\r?\n/));
  return after.split(/\r?\n/).filter((line) => line && !beforeLines.has(line)).length;
}

function directDiffBeforeUri(file: string, content: string): vscode.Uri {
  const uri = vscode.Uri.from({
    scheme: directDiffBeforeScheme,
    path: `/${path.basename(file)}`,
    query: `${Date.now()}-${Math.random().toString(36).slice(2)}`
  });
  directDiffBeforeDocs.set(uri.toString(), content);
  return uri;
}

function labelForRun(options: SkipprRunOptions): string {
  if (options.kind === "discover") {
    return `Discover ${options.pipeline ?? "pipeline"}`;
  }
  if (options.kind === "model-direct") {
    return `Direct model ${options.pipeline ?? "pipeline"}`;
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

function compactTranscriptLine(line: string): string {
  return clipText(scrubLargeEmbeddedData(line), transcriptLineMaxChars);
}

function compactOutputLine(line: string): string {
  const scrubbed = scrubLargeEmbeddedData(line.trimEnd());
  const summary = summarizeJsonLine(scrubbed);
  return clipText(summary ?? scrubbed, outputLineMaxChars);
}

function summarizeJsonLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || trimmed.length <= outputLineMaxChars) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const type = typeof parsed.type === "string" ? parsed.type : undefined;
    const event = typeof parsed.event === "string" ? parsed.event : undefined;
    if (type === "thread_state") {
      const snapshot = parsed.snapshot as Record<string, unknown> | undefined;
      const events = Array.isArray(snapshot?.events) ? snapshot.events.length : undefined;
      const currentPhase = typeof snapshot?.current_phase === "string" ? snapshot.current_phase : undefined;
      return `[skippr-json] thread_state current_phase=${currentPhase ?? "unknown"} events=${events ?? "unknown"} (${trimmed.length} chars elided)`;
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
    const parsed = JSON.parse(trimmed) as Partial<SkipprRunEvent>;
    if (typeof parsed.event === "string") {
      return parsed as SkipprRunEvent;
    }
    if (parsed.event_kind === "tool_start" || parsed.event_kind === "tool_end") {
      return { ...parsed, event: parsed.event_kind } as SkipprRunEvent;
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
    forwardRunTranscriptLine(`${command}`, "shell", chunk, "stdout");
    output.info(compactOutputLine(chunk.trimEnd()));
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    forwardRunTranscriptLine(`${command}`, "shell", chunk, "stderr");
    output.error(compactOutputLine(chunk.trimEnd()));
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
