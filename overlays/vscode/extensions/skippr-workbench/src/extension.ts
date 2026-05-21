import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { loadPanelPayloadFromRust } from "./rustBridge";
import {
  installSkipprCli,
  isSkipprRunKind,
  resolveSkipprCli,
  runSkipprJson,
  skipprProjectRoot,
  showSkipprVersion,
  SkipprProcess,
  SkipprRunKind,
  startSkipprRun,
  updateSkipprCli
} from "./skipprRunner";
import {
  SkipprPipelineCodeLensProvider,
  skipprConfigDocumentSelector
} from "./skipprPipelineCodeLens";
import { takePendingPipelineLensRun, type SkipprPipelineRunCommand } from "./skipprPipelineRunContext";
import { openSkipprPipelineRunMenu } from "./skipprPipelineActionMenu";
import { registerSkipprPipelineTestControllers } from "./skipprPipelineTestController";
import { runSkipprJsonLines, type SkipprTestListJson } from "./skipprDbtTestController";
import { parseShellArgs } from "./skipprCliArgs";
import { mergeSkipprSpawnEnv, workspaceFolderForConfigPath } from "./skipprEnv";
import { registerSkipprConfigDiagnostics } from "./skipprConfigDiagnostics";
import {
  ConnectionSettings,
  SkipprConfigShowResult,
  SkipprDoctorResult,
  SkipprModelChangedFile,
  SkipprPanelId,
  SkipprPanelName,
  SkipprPanelPayload,
  SkipprRunEvent
} from "./types";
import { clearSkipprCliCredentialsFile, writeSkipprCliCredentialsFile } from "./skipprCliCredentials";
import { runEmailOtpAuthQuickInput } from "./skipprOverlayUi";
import { renderSkipprRunStatusPanelHtml } from "./skipprRunStatusPanelHtml";
import { renderSkipprRunDetailsPanelHtml, SkipprRunDetailsViewKind } from "./skipprRunDetailsPanelHtml";
import { renderSkipprSchemaPanelHtml } from "./skipprSchemaPanelHtml";
import {
  renderSkipprQueryResultsPanelHtml,
  SkipprQueryChart,
  SkipprQueryData,
  SkipprQueryResultsPanelPayload
} from "./skipprQueryResultsPanelHtml";
import { renderSkipprLineagePanelHtml, SkipprLineagePanelPayload } from "./skipprLineagePanelHtml";
import {
  compileDbtSqlForQuery,
  detectDbtSqlFile,
  dbtRunModeMenuTitle,
  DbtEditorRunMode,
  probeDbtFileHasTests,
  probeDbtFileMeta,
  refreshDbtEditorContextKeys
} from "./skipprDbtSql";
import { SkipprRunHistory } from "./skipprRunHistory";
import { SkipprObservedRun, SkipprObservedRunStatus, SkipprRunStateStore } from "./skipprRunState";

const SKIPPR_RUN_STATUS_VIEW_ID = "skippr.runStatus";
const SKIPPR_RUN_TIMELINE_VIEW_ID = "skippr.runTimeline";
const SKIPPR_RUN_SCHEMA_CHANGES_VIEW_ID = "skippr.runSchemaChanges";
const SKIPPR_RUN_DEADLETTERS_VIEW_ID = "skippr.runDeadletters";
const SKIPPR_RUN_TIMELINE_CONTAINER_ID = "skippr.run.timeline.panel";
const SKIPPR_QUERY_RESULTS_VIEW_ID = "skippr.queryResults";
const SKIPPR_QUERY_RESULTS_CONTAINER_ID = "skippr.query.results.panel";
const SKIPPR_SCHEMA_VIEW_ID = "skippr.schemaView";
const SKIPPR_SCHEMA_CONTAINER_ID = "skippr.schema.sidebar";
const SKIPPR_LINEAGE_LAUNCH_VIEW_ID = "skippr.lineageLaunch";
const RUN_AND_DEBUG_VIEW_COMMAND = "workbench.view.debug";
const SKIPPR_AGENT_HOST_SESSION_TYPE = "agent-host-skippr";

const panelSpecs: Array<{ id: SkipprPanelId; name: SkipprPanelName; command: string }> = [
  { id: "skippr.discover", name: "Discover", command: "skippr.open.discover" },
  { id: "skippr.sync", name: "Sync", command: "skippr.open.sync" },
  { id: "skippr.model", name: "Model", command: "skippr.open.model" },
  { id: "skippr.catalog", name: "Catalog", command: "skippr.open.catalog" },
  { id: "skippr.lineage", name: "Lineage", command: "skippr.open.lineage" }
];

const workspacePathKey = "skippr.workspacePath";
const apiTargetKey = "skippr.apiTarget";
const authBaseUrlKey = "skippr.auth.baseUrl";
const authTokenKey = "skippr.auth.token";
const authRefreshTokenKey = "skippr.auth.refreshToken";
const authEmailKey = "skippr.auth.email";
const splashDismissedKey = "skippr.splashDismissed.v1";
const cliPathKey = "skippr.cliPath";
const defaultPipelineKey = "skippr.defaultPipeline";
const logLevelKey = "skippr.logLevel";
const runExtraArgsKey = "skippr.run.extraArgs";
const vectorOnOpenStateKey = "skippr.vector.onOpen.lastRun.v1";
const vectorOnOpenExcludeGlobs = [
  ".git/**",
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/.*/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/target/**",
  "**/.next/**",
  "**/coverage/**",
  "**/*secret*",
  "**/*secrets*",
  "**/*credential*",
  "**/*credentials*",
  "**/*token*",
  "**/*private*",
  "**/*.pem",
  "**/*.p8",
  "**/*.key"
];

interface AuthSession {
  token: string;
  refreshToken: string;
  email: string;
}

interface SkipprAccountPayload {
  profile?: { plan?: string };
  balance?: { balance?: number };
  daily_costs_est?: Array<{ date: string; cost: number }>;
  monthly_cost_est?: number;
  recent_usage?: unknown[];
  subscription?: { status?: string; price_id?: string } | null;
  eula?: { version?: string; accepted_at?: string; accepted_via?: string };
}

interface SkipprRunRequest {
  pipeline?: string;
  configPath?: string;
  logLevel?: string;
}

type SkipprRunnableKind = SkipprRunKind | "ask" | "plan";

let activeRun: SkipprProcess | undefined;
let activeConfigPath: string | undefined;
let activeConfigStatus: SkipprDoctorResult | undefined;

class SkipprAuthenticationProvider implements vscode.AuthenticationProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this.emitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly statusItem: vscode.StatusBarItem
  ) {}

  async getSessions(): Promise<vscode.AuthenticationSession[]> {
    const session = await readAuthSession(this.context);
    return session ? [this.toVsCodeSession(session)] : [];
  }

  /** Notifies VS Code that a session was persisted (command palette / webview sign-in). */
  notifySessionCreated(session: AuthSession): void {
    this.emitter.fire({ added: [this.toVsCodeSession(session)], removed: [], changed: [] });
  }

  /** Notifies VS Code that the stored session was removed (sign out, invalid refresh). */
  notifySessionRemoved(session: AuthSession): void {
    this.emitter.fire({ added: [], removed: [this.toVsCodeSession(session)], changed: [] });
  }

  /** Access token rotated server-side; same VS Code session id. */
  notifySessionUpdated(session: AuthSession): void {
    this.emitter.fire({ added: [], removed: [], changed: [this.toVsCodeSession(session)] });
  }

  async createSession(): Promise<vscode.AuthenticationSession> {
    const session = await signIn(this.context, this.statusItem, this, true);
    if (!session) {
      throw new Error("Skippr sign-in was cancelled.");
    }
    return this.toVsCodeSession(session);
  }

  async removeSession(): Promise<void> {
    const session = await readAuthSession(this.context);
    if (session) {
      try {
        await apiRequest("/auth/logout", "POST", undefined, session.token);
      } catch {
        // Best-effort logout; still clear local secrets.
      }
    }
    await clearAuthSession(this.context);
    applySignedOutAuthStatusBar(this.statusItem);
    if (session) {
      this.emitter.fire({ added: [], removed: [this.toVsCodeSession(session)], changed: [] });
    }
  }

  private toVsCodeSession(session: AuthSession): vscode.AuthenticationSession {
    return {
      id: session.email,
      accessToken: session.token,
      account: { id: session.email, label: session.email },
      scopes: ["account"]
    };
  }
}

class SkipprDebugAdapter implements vscode.DebugAdapter {
  private readonly emitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  private sequence = 1;

  readonly onDidSendMessage = this.emitter.event;

  constructor(private readonly run: (configuration: vscode.DebugConfiguration) => Promise<void>) {}

  handleMessage(message: { command?: string; seq?: number; arguments?: vscode.DebugConfiguration }): void {
    if (message.command === "initialize") {
      this.sendResponse(message, { supportsConfigurationDoneRequest: false });
      return;
    }
    if (message.command === "launch") {
      this.sendResponse(message);
      void this.run((message.arguments ?? {}) as vscode.DebugConfiguration).finally(() => {
        this.emitter.fire({ type: "event", event: "terminated", seq: this.sequence++ });
      });
      return;
    }
    if (message.command === "disconnect") {
      this.sendResponse(message);
      this.emitter.fire({ type: "event", event: "terminated", seq: this.sequence++ });
      return;
    }
    this.sendResponse(message);
  }

  dispose(): void {
    this.emitter.dispose();
  }

  private sendResponse(request: { command?: string; seq?: number }, body?: unknown): void {
    this.emitter.fire({
      type: "response",
      seq: this.sequence++,
      request_seq: request.seq ?? 0,
      success: true,
      command: request.command ?? "",
      body
    });
  }
}

function getAuthBaseUrl(): string {
  const configured = vscode.workspace.getConfiguration().get<string>(authBaseUrlKey, "https://auth.skippr.io").trim();
  return configured || "https://auth.skippr.io";
}

function loadConnectionSettings(): ConnectionSettings {
  const config = vscode.workspace.getConfiguration();
  const workspacePath = config.get<string>(workspacePathKey, "").trim();
  const apiTarget = config.get<string>(apiTargetKey, "").trim();
  return { workspacePath, apiTarget: apiTarget || undefined };
}

function renderConnectionFormHtml(workspacePath: string, apiTarget: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
    .card { width: min(540px, calc(100vw - 48px)); padding: 28px; border: 1px solid var(--vscode-panel-border); border-radius: 18px; background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-sideBar-background)); box-shadow: 0 18px 60px rgba(0,0,0,.25); }
    .eyebrow { color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: .12em; font-size: 12px; }
    h1 { margin: 6px 0 14px; font-size: 24px; }
    p { color: var(--vscode-descriptionForeground); line-height: 1.5; }
    label { display: block; margin: 16px 0 7px; font-weight: 600; }
    input { width: 100%; padding: 10px 12px; border-radius: 9px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: inherit; box-sizing: border-box; }
    .actions { display: flex; gap: 10px; margin-top: 22px; }
    button { flex: 1; padding: 10px 12px; border: 0; border-radius: 9px; font: inherit; font-weight: 600; cursor: pointer; }
    .primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .secondary { color: var(--vscode-foreground); background: var(--vscode-button-secondaryBackground); }
  </style>
</head>
<body>
  <main class="card">
    <div class="eyebrow">Skippr Connection</div>
    <h1>Configure Connection</h1>
    <p>Set the local Skippr workspace and optional backend API target.</p>
    <label for="workspacePath">Workspace path</label>
    <input id="workspacePath" value="${escapeHtml(workspacePath)}" placeholder="/path/to/project" autofocus />
    <label for="apiTarget">API target (optional)</label>
    <input id="apiTarget" value="${escapeHtml(apiTarget)}" placeholder="https://api.skippr.io" />
    <div class="actions">
      <button id="cancel" class="secondary">Cancel</button>
      <button id="save" class="primary">Save</button>
    </div>
  </main>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById("cancel").addEventListener("click", () => vscode.postMessage({ command: "cancel" }));
    document.getElementById("save").addEventListener("click", () => vscode.postMessage({
      command: "save",
      workspacePath: document.getElementById("workspacePath").value,
      apiTarget: document.getElementById("apiTarget").value
    }));
  </script>
</body>
</html>`;
}

async function configureConnection(): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const currentWorkspacePath = config.get<string>(workspacePathKey, "");
  const currentApiTarget = config.get<string>(apiTargetKey, "");
  const panel = vscode.window.createWebviewPanel("skippr.connection", "Configure Skippr Connection", vscode.ViewColumn.Active, {
    enableScripts: true
  });
  panel.webview.html = renderConnectionFormHtml(currentWorkspacePath, currentApiTarget);
  panel.webview.onDidReceiveMessage(async (message: { command: string; workspacePath?: string; apiTarget?: string }) => {
    if (message.command === "cancel") {
      panel.dispose();
      return;
    }
    if (message.command === "save") {
      await config.update(workspacePathKey, (message.workspacePath ?? "").trim(), vscode.ConfigurationTarget.Global);
      await config.update(apiTargetKey, (message.apiTarget ?? "").trim(), vscode.ConfigurationTarget.Global);
      panel.dispose();
      vscode.window.showInformationMessage("Skippr connection settings saved.");
    }
  });
}

function getRunCwd(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

function getLogLevel(): string {
  return vscode.workspace.getConfiguration().get<string>(logLevelKey, "info").trim() || "info";
}

function skipprSpawnEnv(configPath: string | undefined, pipeline: string | undefined): NodeJS.ProcessEnv {
  const folder = workspaceFolderForConfigPath(configPath);
  return mergeSkipprSpawnEnv(process.env, folder, pipeline, configPath);
}

const SKIPPR_RUN_TOOLBAR_CONTEXT_KEY = "skippr.runToolbarInTitle";

function getConfigCwd(configPath?: string): string {
  return skipprProjectRoot(configPath, getRunCwd());
}

async function detectSkipprConfigs(): Promise<string[]> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    return [];
  }
  const found: string[] = [];
  for (const name of ["skippr.yml", "skippr.yaml"]) {
    const uri = vscode.Uri.joinPath(root, name);
    try {
      await vscode.workspace.fs.stat(uri);
      found.push(uri.fsPath);
    } catch {
      // Missing config files are expected in non-Skippr workspaces.
    }
  }
  return found;
}

/** `skippr.yml` / `skippr.yaml` next to the effective run CWD (workspace Skippr path / first folder). */
async function resolveSkipprConfigAtCwd(): Promise<string> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    return "";
  }
  for (const name of ["skippr.yml", "skippr.yaml"]) {
    const fsPath = path.join(cwd, name);
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(fsPath));
      return fsPath;
    } catch {
      // try next name
    }
  }
  return "";
}

function isWorkspaceRootConfigPath(configPath: string | undefined): boolean {
  if (!configPath) {
    return false;
  }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    return false;
  }
  const normalized = path.resolve(configPath);
  return normalized === path.join(root, "skippr.yml") || normalized === path.join(root, "skippr.yaml");
}

async function chooseActiveConfig(output: vscode.LogOutputChannel): Promise<string | undefined> {
  const configs = await detectSkipprConfigs();
  if (configs.length === 0) {
    activeConfigPath = undefined;
    output.info("No skippr.yml or skippr.yaml found in workspace folders.");
    return undefined;
  }
  if (configs.length === 1) {
    activeConfigPath = configs[0];
    return activeConfigPath;
  }
  activeConfigPath = configs[0];
  output.info(`Multiple Skippr configs found. Using ${activeConfigPath}.`);
  return activeConfigPath;
}

async function refreshConfigStatus(output: vscode.LogOutputChannel, statusItem: vscode.StatusBarItem): Promise<void> {
  const configPath = activeConfigPath ?? (await chooseActiveConfig(output));
  if (!configPath) {
    activeConfigStatus = undefined;
    statusItem.command = "skippr.setupWorkspace";
    statusItem.text = "$(warning) Skippr: not initialized";
    statusItem.tooltip = "No skippr.yml or skippr.yaml found. Click to set up Skippr.";
    return;
  }
  const cliPath = await resolveSkipprCli(vscode.workspace.getConfiguration().get<string>(cliPathKey, ""));
  if (!cliPath) {
    statusItem.command = "skippr.cli.install";
    statusItem.text = "$(warning) Skippr: CLI missing";
    statusItem.tooltip = "Skippr CLI was not found. Click to install.";
    return;
  }

  const configResultValue = await getCachedConfigShow(output, configPath, "silent");
  if (!configResultValue?.ok) {
    activeConfigStatus = undefined;
    statusItem.command = "skippr.setupWorkspace";
    statusItem.text = "$(warning) Skippr: config invalid";
    statusItem.tooltip = `Unable to parse ${configPath}`;
    return;
  }

  const hasPipelines = configResultValue.pipelines.length > 0;
  const hasConnections = configResultValue.sources.length > 0 && configResultValue.sinks.length > 0;
  activeConfigStatus = {
    ok: true,
    config_path: configPath,
    checks: [
      { ok: true, severity: "info", message: "config file is valid" },
      {
        ok: hasConnections,
        severity: hasConnections ? "info" : "warning",
        message: hasConnections ? "source and sink configured" : "source and sink not configured yet"
      }
    ]
  };

  if (hasPipelines && hasConnections) {
    statusItem.command = "skippr.run.discoverPipeline";
    statusItem.text = "$(pass) Skippr: ready";
    statusItem.tooltip = `Using ${configPath}`;
  } else {
    statusItem.command = "skippr.setupWorkspace";
    statusItem.text = "$(circle-outline) Skippr: initialized";
    statusItem.tooltip = `Config is valid. Add a source and warehouse to make ${configPath} ready.`;
  }
}

async function getConfigShow(output: vscode.LogOutputChannel): Promise<SkipprConfigShowResult | undefined> {
  if (!activeConfigPath) {
    await chooseActiveConfig(output);
  }
  const configPath = activeConfigPath;
  if (!configPath) {
    return undefined;
  }
  return getCachedConfigShow(output, configPath, "offerInstall");
}

/** `skippr config show` rarely changes; cache aggressively and coalesce concurrent reads. */
const CONFIG_SHOW_CACHE_TTL_MS = 10 * 60 * 1000;

type ConfigShowCliResolve = "silent" | "offerInstall";

let configShowCache: { path: string; expires: number; value: SkipprConfigShowResult | undefined } | undefined;
const configShowInflight = new Map<string, Promise<SkipprConfigShowResult | undefined>>();
/** Bumped on cache invalidation so late CLI results do not repopulate the cache. */
let configShowCacheGeneration = 0;

function invalidateToolbarConfigShowCache(): void {
  configShowCache = undefined;
  configShowCacheGeneration++;
}

async function getCachedConfigShow(
  output: vscode.LogOutputChannel,
  configPath: string,
  resolveCli: ConfigShowCliResolve
): Promise<SkipprConfigShowResult | undefined> {
  const trimmed = configPath.trim();
  if (!trimmed) {
    return undefined;
  }
  const now = Date.now();
  const hit = configShowCache;
  if (hit && hit.path === trimmed && hit.expires > now) {
    return hit.value;
  }
  let inflight = configShowInflight.get(trimmed);
  if (inflight) {
    return inflight;
  }
  inflight = (async (): Promise<SkipprConfigShowResult | undefined> => {
    const fetchGeneration = configShowCacheGeneration;
    try {
      const cliPath =
        resolveCli === "offerInstall"
          ? await resolveCliOrOfferInstall(output)
          : await resolveSkipprCli(vscode.workspace.getConfiguration().get<string>(cliPathKey, ""));
      if (!cliPath) {
        return undefined;
      }
      const result = await runSkipprJson<SkipprConfigShowResult>(
        cliPath,
        ["--config", trimmed, "config", "show"],
        getConfigCwd(trimmed),
        output,
        skipprSpawnEnv(trimmed, undefined),
        trimmed
      );
      const value = result.value;
      if (fetchGeneration === configShowCacheGeneration) {
        configShowCache = { path: trimmed, expires: Date.now() + CONFIG_SHOW_CACHE_TTL_MS, value };
      }
      return value;
    } finally {
      configShowInflight.delete(trimmed);
    }
  })();
  configShowInflight.set(trimmed, inflight);
  return inflight;
}

async function getToolbarConfigShow(
  output: vscode.LogOutputChannel,
  configPath: string
): Promise<SkipprConfigShowResult | undefined> {
  return getCachedConfigShow(output, configPath, "silent");
}

async function fetchTestSelectOptionsForRunDebug(
  output: vscode.LogOutputChannel,
  configPath: string,
  pipeline: string
): Promise<Array<{ value: string; label: string }>> {
  const cfg = configPath.trim();
  const pipe = pipeline.trim();
  if (!cfg || !pipe) {
    return [];
  }
  const cliPath = await resolveSkipprCli(vscode.workspace.getConfiguration().get<string>(cliPathKey, ""));
  if (!cliPath) {
    return [];
  }
  const result = await runSkipprJson<SkipprTestListJson>(
    cliPath,
    ["--config", cfg, "test", "list", "--pipeline", pipe, "--output", "json"],
    getConfigCwd(cfg),
    output,
    skipprSpawnEnv(cfg, pipe),
    cfg
  );
  const rows = result.value?.tests;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map((t: SkipprTestListJson["tests"][0]) => ({
    value: t.unique_id,
    label: t.name?.trim() ? `${t.name} (${t.unique_id})` : t.unique_id
  }));
}

function runKindLabel(kind: SkipprRunnableKind): string {
  switch (kind) {
    case "ask":
      return "Ask";
    case "plan":
      return "Plan";
    case "discover":
      return "Discover";
    case "sync-once":
      return "Sync Once";
    case "sync-all-once":
      return "Sync All Once";
    case "sync":
      return "Start Sync";
    case "model":
      return "Model";
  }
}

function renderRunConfigHtml(kind: SkipprRunnableKind, pipelines: string[], configPaths: string[], configPath: string | undefined, defaultPipeline: string, logLevel: string): string {
  const pipelineOptions = pipelines
    .map((pipeline) => `<option value="${escapeHtml(pipeline)}" ${pipeline === defaultPipeline ? "selected" : ""}>${escapeHtml(pipeline)}</option>`)
    .join("");
  const configOptions = configPaths
    .map((pathValue) => `<option value="${escapeHtml(pathValue)}" ${pathValue === configPath ? "selected" : ""}>${escapeHtml(pathValue)}</option>`)
    .join("");
  const needsPipeline = kind !== "sync-all-once";
  const showLogLevel = kind !== "discover";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
    .card { width: min(520px, calc(100vw - 48px)); padding: 26px; border: 1px solid var(--vscode-panel-border); border-radius: 16px; background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-sideBar-background)); box-shadow: 0 18px 60px rgba(0,0,0,.25); }
    .eyebrow { color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: .12em; font-size: 12px; }
    h1 { margin: 6px 0 18px; font-size: 24px; }
    label { display: block; margin: 16px 0 7px; font-weight: 600; }
    input, select { width: 100%; padding: 10px 12px; border-radius: 9px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: inherit; }
    .muted { color: var(--vscode-descriptionForeground); line-height: 1.5; }
    .actions { display: flex; gap: 10px; margin-top: 22px; }
    button { flex: 1; padding: 10px 12px; border: 0; border-radius: 9px; font: inherit; font-weight: 600; cursor: pointer; }
    .primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .secondary { color: var(--vscode-foreground); background: var(--vscode-button-secondaryBackground); }
  </style>
</head>
<body>
  <main class="card">
    <div class="eyebrow">Skippr Run Configuration</div>
    <h1>${escapeHtml(runKindLabel(kind))}</h1>
    <p class="muted">Choose the config and run parameters. Output streams to the Skippr output channel and the status bar shows progress.</p>
    ${needsPipeline ? `<label for="pipeline">Pipeline</label>
      ${pipelines.length ? `<select id="pipeline">${pipelineOptions}</select>` : `<input id="pipeline" value="${escapeHtml(defaultPipeline)}" placeholder="Pipeline name" />`}` : ""}
    <label for="configPath">Config path</label>
    ${configPaths.length ? `<select id="configPath">${configOptions}</select>` : `<input id="configPath" value="${escapeHtml(configPath ?? "")}" placeholder="skippr.yml" />`}
    ${
      showLogLevel
        ? `<label for="logLevel">Log level</label>
    <select id="logLevel">
      ${["debug", "info", "warn", "error"].map((level) => `<option value="${level}" ${level === logLevel ? "selected" : ""}>${level}</option>`).join("")}
    </select>`
        : ""
    }
    <div class="actions">
      <button id="cancel" class="secondary">Cancel</button>
      <button id="run" class="primary">Run ${escapeHtml(runKindLabel(kind))}</button>
    </div>
  </main>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById("cancel").addEventListener("click", () => vscode.postMessage({ command: "cancel" }));
    document.getElementById("run").addEventListener("click", () => vscode.postMessage({
      command: "run",
      pipeline: document.getElementById("pipeline")?.value ?? "",
      configPath: document.getElementById("configPath").value,
      logLevel: document.getElementById("logLevel")?.value ?? ""
    }));
  </script>
</body>
</html>`;
}

async function showRunConfigModal(kind: SkipprRunnableKind, output: vscode.LogOutputChannel): Promise<SkipprRunRequest | undefined> {
  const config = vscode.workspace.getConfiguration();
  const configs = await detectSkipprConfigs();
  const configPath = activeConfigPath || configs[0];
  if (configPath) {
    activeConfigPath = configPath;
  }
  const configShow = await getConfigShow(output);
  const defaultPipeline = configShow?.default_pipeline ?? config.get<string>(defaultPipelineKey, "").trim();
  const panel = vscode.window.createWebviewPanel("skippr.runConfig", `Skippr: ${runKindLabel(kind)}`, vscode.ViewColumn.Active, { enableScripts: true });
  panel.webview.html = renderRunConfigHtml(kind, configShow?.pipelines ?? [], configs, configPath, defaultPipeline, getLogLevel());
  return new Promise((resolve) => {
    panel.onDidDispose(() => resolve(undefined));
    panel.webview.onDidReceiveMessage(async (message: { command: string; pipeline?: string; configPath?: string; logLevel?: string }) => {
      if (message.command === "cancel") {
        panel.dispose();
        resolve(undefined);
        return;
      }
      if (message.command === "run") {
        const pipeline = message.pipeline?.trim();
        if (pipeline) {
          await config.update(defaultPipelineKey, pipeline, vscode.ConfigurationTarget.Global);
        }
        panel.dispose();
        resolve({
          pipeline,
          configPath: message.configPath?.trim(),
          logLevel: message.logLevel?.trim()
        });
      }
    });
  });
}

function describeRunEvent(event: SkipprRunEvent): string | undefined {
  switch (event.event) {
    case "discover_start":
      return `Discover started: ${event.pipeline ?? "pipeline"}`;
    case "namespace_discovered":
      return `Discovered ${event.namespace ?? "namespace"} (${event.field_count ?? 0} fields)`;
    case "schema_evolved":
      return `Schema evolved: ${event.namespace ?? "namespace"} (${event.fields_added?.length ?? 0} added)`;
    case "discover_complete":
      return `Discover complete: ${event.pipeline ?? "pipeline"} (${event.namespaces_discovered ?? 0} namespaces)`;
    case "sync_start":
      return `Sync started: ${event.pipeline ?? "pipeline"}`;
    case "sync_status":
      return `Sync status: ${event.pipeline ?? "pipeline"} rows=${event.total_rows ?? 0} written=${event.rows_written ?? 0}`;
    case "batch_ingested":
      return `Batch ingested: ${event.namespace ?? "namespace"} rows=${event.rows ?? 0}`;
    case "compaction_complete":
      return `Compaction complete: ${event.namespace ?? "namespace"}`;
    case "output_synced":
      return `Output synced: ${event.namespace ?? "namespace"} rows=${event.rows_written ?? 0}`;
    case "sync_complete":
      return `Sync complete: ${event.pipeline ?? "pipeline"} rows=${event.total_rows ?? 0}`;
    case "sync_error":
      return `Sync error: ${event.error ?? "unknown error"}`;
    case "tool_start":
      return undefined;
    case "tool_end":
      if (event.status === "ok" || event.status === "success") {
        return undefined;
      }
      return `Tool ${event.status ?? "finished"}: ${event.clean_name ?? event.name ?? "tool"}`;
    case "model_start":
      return `Model started: ${event.pipeline ?? "pipeline"}`;
    case "model_thread_resumed":
      return `Model resumed thread ${event.thread_id ?? "unknown"}`;
    case "model_preflight":
      return event.model_preflight?.ok
        ? `Model preflight passed: ${event.model_preflight.command ?? "dbt"}`
        : `Model preflight failed: ${event.model_preflight?.remediation ?? event.error ?? "dbt environment issue"}`;
    case "model_authoring_start":
      return `Model authoring started`;
    case "model_file_changed":
      return `Model files changed: ${event.changed_files?.length ?? 0}`;
    case "model_review_ready":
      return event.summary ?? `Model review ready: ${event.total_count ?? event.changed_files?.length ?? 0} files`;
    case "model_validation_start":
      return `Model validation started`;
    case "model_validation":
      return event.validation?.ok
        ? `Model validation passed`
        : `Model validation failed: ${event.validation?.message ?? event.error ?? "unknown error"}`;
    case "model_validation_complete":
      return event.validation?.ok
        ? `Model validation passed`
        : `Model validation failed: ${event.validation?.message ?? event.error ?? "unknown error"}`;
    case "model_phase_changed":
      return `Model phase: ${event.phase ?? "unknown"}`;
    case "model_complete":
      return `Model complete: ${event.pipeline ?? "pipeline"}`;
    case "model_error":
      return `Model error: ${event.error ?? event.failure_summary ?? "unknown error"}`;
    case "ask_start":
      return `Ask started: ${event.pipeline ?? "pipeline"}`;
    case "ask_complete":
      return `Ask complete: ${event.pipeline ?? "pipeline"}`;
    case "ask_error":
      return `Ask error: ${event.error ?? "unknown error"}`;
    case "plan_start":
      return `Plan started: ${event.pipeline ?? "pipeline"}`;
    case "plan_complete":
      return `Plan complete: ${event.pipeline ?? "pipeline"}`;
    case "plan_error":
      return `Plan error: ${event.error ?? "unknown error"}`;
  }
  return undefined;
}

type RunStatusPanelPhase = "idle" | "running" | "success" | "error" | "stopped";

interface RunStatusPanelPayload {
  type: "status";
  phase: RunStatusPanelPhase;
  headline: string;
  detail?: string;
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number | null;
  signal?: string | null;
  elapsedMs?: number | null;
}

let runStatusWebviewView: vscode.WebviewView | undefined;
const runDetailsWebviewViews = new Map<string, vscode.WebviewView>();
let schemaWebviewView: vscode.WebviewView | undefined;
let queryResultsWebviewView: vscode.WebviewView | undefined;
let observabilityStore: SkipprRunStateStore | undefined;
let runHistory: SkipprRunHistory | undefined;
let pendingHistorySave: SkipprObservedRun | undefined;
let historySaveTimer: ReturnType<typeof setTimeout> | undefined;
let historyRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let observabilityPostTimer: ReturnType<typeof setTimeout> | undefined;
const HISTORY_SAVE_DEBOUNCE_MS = 750;
const HISTORY_REFRESH_DEBOUNCE_MS = 300;
const OBSERVABILITY_POST_DEBOUNCE_MS = 100;
let runStatusPanelLast: RunStatusPanelPayload = {
  type: "status",
  phase: "idle",
  headline: "No Skippr run yet.",
  detail: ""
};
let queryResultsLastPayload: SkipprQueryResultsPanelPayload = {
  type: "queryResults",
  status: "idle"
};
/** Start time for the current status-bar run session (first `setRunStatusRunning` after last finish). */
let activeRunStatusStartedAt: number | undefined;

function postRunStatusPanel(payload: RunStatusPanelPayload): void {
  runStatusPanelLast = payload;
  const snapshot = observabilityStore?.snapshot();
  if (snapshot?.current || (snapshot?.selected && payload.phase === "idle")) {
    return;
  }
  void runStatusWebviewView?.webview.postMessage(payload);
}

function postObservability(): void {
  if (observabilityPostTimer) {
    clearTimeout(observabilityPostTimer);
    observabilityPostTimer = undefined;
  }
  const snapshot = observabilityStore?.snapshot();
  if (!snapshot) {
    return;
  }
  void runStatusWebviewView?.webview.postMessage(snapshot);
  for (const webviewView of runDetailsWebviewViews.values()) {
    void webviewView.webview.postMessage(snapshot);
  }
  void schemaWebviewView?.webview.postMessage(snapshot);
}

function schedulePostObservability(): void {
  if (observabilityPostTimer) {
    clearTimeout(observabilityPostTimer);
  }
  observabilityPostTimer = setTimeout(() => {
    observabilityPostTimer = undefined;
    postObservability();
  }, OBSERVABILITY_POST_DEBOUNCE_MS);
}

function postQueryResults(payload: SkipprQueryResultsPanelPayload): void {
  queryResultsLastPayload = payload;
  void queryResultsWebviewView?.webview.postMessage(payload);
}

async function showQueryResultsPanel(): Promise<void> {
  await runWorkbenchCommand(`workbench.view.extension.${SKIPPR_QUERY_RESULTS_CONTAINER_ID}`);
  await runWorkbenchCommand(`${SKIPPR_QUERY_RESULTS_VIEW_ID}.focus`);
  postQueryResults(queryResultsLastPayload);
}

function scheduleRefreshRunHistory(): void {
  if (historyRefreshTimer) {
    clearTimeout(historyRefreshTimer);
  }
  historyRefreshTimer = setTimeout(() => {
    historyRefreshTimer = undefined;
    void refreshRunHistory();
  }, HISTORY_REFRESH_DEBOUNCE_MS);
}

async function refreshRunHistory(): Promise<void> {
  if (!runHistory || !observabilityStore) {
    return;
  }
  try {
    observabilityStore.setHistory(await runHistory.recentRuns());
  } catch {
    // History is optional; runs must still work if sqlite is unavailable.
  }
}

function scheduleHistorySave(run: SkipprObservedRun): void {
  pendingHistorySave = run;
  if (historySaveTimer) {
    clearTimeout(historySaveTimer);
  }
  historySaveTimer = setTimeout(() => {
    historySaveTimer = undefined;
    const snapshot = pendingHistorySave;
    pendingHistorySave = undefined;
    if (!snapshot) {
      return;
    }
    void runHistory?.saveRun(snapshot).then(() => scheduleRefreshRunHistory(), () => undefined);
  }, HISTORY_SAVE_DEBOUNCE_MS);
}

function flushHistorySave(run: SkipprObservedRun): void {
  if (historySaveTimer) {
    clearTimeout(historySaveTimer);
    historySaveTimer = undefined;
  }
  pendingHistorySave = undefined;
  void runHistory?.saveRun(run).then(() => scheduleRefreshRunHistory(), () => undefined);
}

async function openHistoricalRun(runId: string | undefined): Promise<void> {
  if (!runId || !runHistory || !observabilityStore) {
    return;
  }
  try {
    const run = await runHistory.loadRun(runId);
    observabilityStore.selectRun(run);
    await showRunDetailsPanel();
  } catch {
    // Already logged by the history layer.
  }
}

async function showRunDetailsPanel(): Promise<void> {
  await runWorkbenchCommand("skippr.workbench.forceRunPanels");
  await runWorkbenchCommand(`workbench.view.extension.${SKIPPR_RUN_TIMELINE_CONTAINER_ID}`);
  await runWorkbenchCommand(`${SKIPPR_RUN_TIMELINE_VIEW_ID}.focus`);
  postObservability();
}

async function showSchemaPanel(): Promise<void> {
  await runWorkbenchCommand("skippr.workbench.forceSchemaSidebar");
  await runWorkbenchCommand(`workbench.view.extension.${SKIPPR_SCHEMA_CONTAINER_ID}`);
  await runWorkbenchCommand(`${SKIPPR_SCHEMA_VIEW_ID}.focus`);
  postObservability();
}

function finishRunStatusPanel(outcome: {
  headline: string;
  code: number | null;
  signal: string | null | undefined;
  elapsedMs: number;
  /** When set, overrides success derived from exit code / signal (e.g. doctor logical ok). */
  logicalOk?: boolean;
  detail?: string;
}): void {
  const signal = outcome.signal ?? null;
  const stopped = Boolean(signal);
  const derivedOk = outcome.code === 0 && !stopped;
  const ok = outcome.logicalOk !== undefined ? outcome.logicalOk : derivedOk;
  const phase: RunStatusPanelPhase = stopped ? "stopped" : ok ? "success" : "error";
  const finishedAt = Date.now();
  const startedAt = activeRunStatusStartedAt;
  const detail =
    outcome.detail ??
    (stopped
      ? `Stopped${signal ? ` (${signal})` : ""} · ${outcome.elapsedMs} ms`
      : ok
        ? `Finished in ${outcome.elapsedMs} ms${outcome.code !== null && outcome.code !== undefined ? ` · exit ${outcome.code}` : ""}`
        : `Failed · exit ${outcome.code ?? "?"}${signal ? ` (${signal})` : ""} · ${outcome.elapsedMs} ms`);
  postRunStatusPanel({
    type: "status",
    phase,
    headline: outcome.headline,
    detail,
    startedAt,
    finishedAt,
    exitCode: outcome.code,
    signal,
    elapsedMs: outcome.elapsedMs
  });
  activeRunStatusStartedAt = undefined;
}

function registerSkipprRunStatusView(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SKIPPR_RUN_STATUS_VIEW_ID,
      {
        resolveWebviewView(webviewView: vscode.WebviewView): void {
          webviewView.webview.options = { enableScripts: true };
          webviewView.webview.html = renderSkipprRunStatusPanelHtml();
          runStatusWebviewView = webviewView;
          postRunStatusPanel(runStatusPanelLast);
          postObservability();
          webviewView.webview.onDidReceiveMessage((message: { command?: string; runId?: string }) => {
            if (message.command === "openRun") {
              void openHistoricalRun(message.runId);
            }
          });
          webviewView.onDidDispose(() => {
            if (runStatusWebviewView === webviewView) {
              runStatusWebviewView = undefined;
            }
          });
        }
      },
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
}

function registerSkipprRunDetailsView(
  context: vscode.ExtensionContext,
  viewId: string,
  viewKind: SkipprRunDetailsViewKind
): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      viewId,
      {
        resolveWebviewView(webviewView: vscode.WebviewView): void {
          webviewView.webview.options = { enableScripts: true };
          webviewView.webview.html = renderSkipprRunDetailsPanelHtml(viewKind);
          runDetailsWebviewViews.set(viewId, webviewView);
          postObservability();
          webviewView.onDidDispose(() => {
            if (runDetailsWebviewViews.get(viewId) === webviewView) {
              runDetailsWebviewViews.delete(viewId);
            }
          });
        }
      },
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
}

function registerSkipprSchemaView(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SKIPPR_SCHEMA_VIEW_ID,
      {
        resolveWebviewView(webviewView: vscode.WebviewView): void {
          webviewView.webview.options = { enableScripts: true };
          webviewView.webview.html = renderSkipprSchemaPanelHtml();
          schemaWebviewView = webviewView;
          postObservability();
          webviewView.onDidDispose(() => {
            if (schemaWebviewView === webviewView) {
              schemaWebviewView = undefined;
            }
          });
        }
      },
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
}

function renderLineageLaunchHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
  <style>
    body { margin: 0; padding: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 12px var(--vscode-font-family); }
    h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; }
    p { margin: 0 0 12px; color: var(--vscode-descriptionForeground); line-height: 1.4; }
  </style>
</head>
<body>
  <h2>Lineage</h2>
  <p>Opening the lineage graph.</p>
</body>
</html>`;
}

function registerSkipprLineageLaunchView(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SKIPPR_LINEAGE_LAUNCH_VIEW_ID,
      {
        resolveWebviewView(webviewView: vscode.WebviewView): void {
          webviewView.webview.options = { enableScripts: true };
          webviewView.webview.html = renderLineageLaunchHtml();
          void vscode.commands.executeCommand("skippr.open.lineage");
        }
      },
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
}

function registerSkipprQueryResultsView(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SKIPPR_QUERY_RESULTS_VIEW_ID,
      {
        resolveWebviewView(webviewView: vscode.WebviewView): void {
          webviewView.webview.options = { enableScripts: true };
          webviewView.webview.html = renderSkipprQueryResultsPanelHtml();
          queryResultsWebviewView = webviewView;
          postQueryResults(queryResultsLastPayload);
          webviewView.webview.onDidReceiveMessage((message: { command?: string; text?: string }) => {
            if (message.command === "copy" && typeof message.text === "string") {
              void vscode.env.clipboard.writeText(message.text);
            }
          });
          webviewView.onDidDispose(() => {
            if (queryResultsWebviewView === webviewView) {
              queryResultsWebviewView = undefined;
            }
          });
        }
      },
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
}

function setRunStatusIdle(statusItem: vscode.StatusBarItem): void {
  statusItem.command = "skippr.run.discoverPipeline";
  statusItem.text = "$(play) Skippr";
  statusItem.tooltip = "Run Skippr discover or sync commands";
}

function revealRunAndDebugView(): void {
  void vscode.commands.executeCommand(RUN_AND_DEBUG_VIEW_COMMAND).then(undefined, () => undefined);
}

function setRunStatusRunning(statusItem: vscode.StatusBarItem, label: string): void {
  statusItem.command = "skippr.run.stopSyncPipeline";
  statusItem.text = `$(sync~spin) ${label}`;
  statusItem.tooltip = "Skippr is running. Click to stop.";
  if (activeRunStatusStartedAt === undefined) {
    revealRunAndDebugView();
    activeRunStatusStartedAt = Date.now();
  }
  postRunStatusPanel({
    type: "status",
    phase: "running",
    headline: label,
    detail: "In progress…",
    startedAt: activeRunStatusStartedAt
  });
}

async function resolveCliOrOfferInstall(output: vscode.LogOutputChannel): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration();
  const cliPath = await resolveSkipprCli(config.get<string>(cliPathKey, ""));
  if (cliPath) {
    return cliPath;
  }
  output.show(true);
  output.warn("Skippr CLI was not found on PATH.");
  const choice = await vscode.window.showWarningMessage("Skippr CLI was not found.", "Install CLI");
  if (choice === "Install CLI") {
    const result = await installSkipprCli(output);
    if (result.code === 0) {
      return resolveSkipprCli(config.get<string>(cliPathKey, ""));
    }
  }
  return undefined;
}

async function runSkipprDoctor(
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem,
  requestedConfigPath?: string,
  options?: { logLevel?: string; extraCliArgs?: string[] }
): Promise<void> {
  const configPath = requestedConfigPath?.trim() || activeConfigPath || (await chooseActiveConfig(output));
  if (!configPath) {
    vscode.window.showWarningMessage("No Skippr config found. Use Skippr: Setup Workspace first.");
    await showSetupWebview(output, statusItem);
    return;
  }
  if (!isWorkspaceRootConfigPath(configPath)) {
    vscode.window.showWarningMessage("Skippr commands require skippr.yml or skippr.yaml at the open workspace root.");
    return;
  }
  const cliPath = await resolveCliOrOfferInstall(output);
  if (!cliPath) {
    return;
  }
  const logLevel = (options?.logLevel ?? getLogLevel()).trim();
  const extra = options?.extraCliArgs ?? [];
  const args = ["--config", configPath];
  if (logLevel) {
    args.push("--log", logLevel);
  }
  args.push("doctor", "--output", "json", ...extra);
  output.show(true);
  setRunStatusRunning(statusItem, "Doctor");
  const result = await runSkipprJson<SkipprDoctorResult>(
    cliPath,
    args,
    getConfigCwd(configPath),
    output,
    skipprSpawnEnv(configPath, undefined),
    configPath
  );
  const summary = result.value;
  const doctorLogicalOk = Boolean(result.code === 0 && summary?.ok);
  finishRunStatusPanel({
    headline: "Doctor",
    code: result.code,
    signal: result.signal,
    elapsedMs: result.elapsedMs,
    logicalOk: doctorLogicalOk,
    detail: doctorLogicalOk ? "All checks passed." : "Some checks failed or the CLI reported issues — see output."
  });
  setRunStatusIdle(statusItem);
  if (summary?.checks?.length) {
    for (const check of summary.checks) {
      const line = `${check.ok ? "ok" : "fail"} [${check.severity}] ${check.message}`;
      if (check.ok) {
        output.info(line);
      } else {
        output.warn(line);
      }
      if (check.suggested_fix_command) {
        output.info(`  suggested: ${check.suggested_fix_command}`);
      }
    }
  } else if (result.stdout.trim()) {
    output.info(result.stdout.trimEnd());
  }
  await refreshConfigStatus(output, statusItem);
  if (result.code === 0 && summary?.ok) {
    output.info("Doctor finished: all checks passed.");
    vscode.window.showInformationMessage("Skippr doctor: all checks passed.");
  } else {
    output.error("Doctor found issues. See Skippr output for details.");
    vscode.window.showWarningMessage("Skippr doctor reported issues. See Skippr output.");
  }
}

type RunSkipprCliFlags = {
  discoverOutput?: string;
  modelNoResume?: boolean;
};

type RunSkipprObserver = {
  onEvent?(event: SkipprRunEvent, observed: SkipprObservedRun | undefined): void;
  onLog?(line: string): void;
  onFinish?(result: { code: number | null; signal: string | null; elapsedMs: number; errorDetail?: string }, finishedRun: SkipprObservedRun | undefined): void;
};

type AgentModelRunRequest = {
  id?: string;
  kind?: string;
  pipeline?: string;
  configPath?: string;
  noResume?: boolean;
  workspaceRoot?: string;
  sourceChatSessionId?: string;
  sourceTurnId?: string;
};

type DbtFileSnapshot = Map<string, string | undefined>;

function runOutcomeStatus(code: number | null, signal: string | null | undefined): SkipprObservedRunStatus {
  if (signal) {
    return "stopped";
  }
  return code === 0 ? "success" : "error";
}

async function runSkipprCommand(
  kind: SkipprRunKind,
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem,
  requestedPipeline?: string,
  requestedConfigPath?: string,
  requestedLogLevel?: string,
  extraCliArgs?: string[],
  cliFlags?: RunSkipprCliFlags,
  observer?: RunSkipprObserver
): Promise<{ code: number | null; signal: string | null; elapsedMs: number; errorDetail?: string } | undefined> {
  if (activeRun) {
    if (kind === "model") {
      output.show(true);
      output.info(`Attached to active ${activeRun.label}. Stop/cancel is the only in-flight control surface.`);
      vscode.window.showInformationMessage(`Attached to active ${activeRun.label}.`);
      const result = { code: null, signal: null, elapsedMs: 0, errorDetail: `Another Skippr run is already active: ${activeRun.label}` };
      observer?.onFinish?.(result, observabilityStore?.snapshot().current);
      return result;
    }
    vscode.window.showWarningMessage(`Skippr is already running: ${activeRun.label}`);
    output.show(true);
    return undefined;
  }

  const skipModal =
    extraCliArgs !== undefined ||
    Boolean(requestedPipeline?.trim()) ||
    Boolean(requestedConfigPath?.trim()) ||
    Boolean(requestedLogLevel?.trim());
  let request: SkipprRunRequest | undefined;
  if (!skipModal) {
    request = await showRunConfigModal(kind, output);
    if (!request) {
      return undefined;
    }
  }

  const pipeline = kind === "sync-all-once" ? undefined : requestedPipeline?.trim() || request?.pipeline?.trim();
  if (kind !== "sync-all-once" && !pipeline) {
    return undefined;
  }

  const configPath = requestedConfigPath?.trim() || request?.configPath?.trim() || activeConfigPath || (await chooseActiveConfig(output));
  if (!configPath) {
    vscode.window.showWarningMessage("No Skippr config found. Use Skippr: Setup Workspace first.");
    await showSetupWebview(output, statusItem);
    return undefined;
  }
  if (!isWorkspaceRootConfigPath(configPath)) {
    vscode.window.showWarningMessage("Skippr commands require skippr.yml or skippr.yaml at the open workspace root.");
    return undefined;
  }

  const cliPath = await resolveCliOrOfferInstall(output);
  if (!cliPath) {
    return undefined;
  }

  output.show(true);
  const run = startSkipprRun(
    {
      kind,
      cliPath,
      cwd: getConfigCwd(configPath),
      configPath,
      pipeline,
      logLevel: requestedLogLevel?.trim() || request?.logLevel?.trim() || getLogLevel(),
      discoverOutput: kind === "discover" ? cliFlags?.discoverOutput : undefined,
      modelNoResume: kind === "model" ? cliFlags?.modelNoResume : undefined,
      extraArgs: extraCliArgs ?? [],
      spawnEnv: skipprSpawnEnv(configPath, pipeline)
    },
    {
      onEvent: (event) => {
        const observed = observabilityStore?.recordEvent(event);
        observer?.onEvent?.(event, observed);
        const message = event.event === "sync_status" ? undefined : describeRunEvent(event);
        if (message) {
          output.info(message);
          setRunStatusRunning(statusItem, message);
        }
        if (observed && event.event !== "sync_status") {
          scheduleHistorySave(observed);
          if (kind === "discover" || kind === "sync" || kind === "sync-once" || kind === "sync-all-once") {
            void showRunDetailsPanel();
            void showSchemaPanel();
          }
        }
      },
      onLog: (line) => {
        observer?.onLog?.(line);
        output.info(line);
      }
    }
  );

  activeRun = run;
  observabilityStore?.startRun({
    command: kind,
    label: run.label,
    pipeline,
    configPath
  });
  void showRunDetailsPanel();
  if (kind === "discover" || kind === "sync" || kind === "sync-once" || kind === "sync-all-once") {
    void showSchemaPanel();
  }
  const runDisplayName = pipeline ?? run.label;
  setRunStatusRunning(statusItem, runDisplayName);
  const result = await run.done;
  if (activeRun === run) {
    activeRun = undefined;
  }

  finishRunStatusPanel({
    headline: runDisplayName,
    code: result.code,
    signal: result.signal,
    elapsedMs: result.elapsedMs
  });
  const finishedRun = observabilityStore?.finishRun({
    status: runOutcomeStatus(result.code, result.signal),
    exitCode: result.code,
    signal: result.signal,
    elapsedMs: result.elapsedMs,
    detail: result.lastEvent?.error ?? result.lastEvent?.failure_summary ?? result.errorDetail
  });
  observer?.onFinish?.(result, finishedRun);
  if (finishedRun) {
    flushHistorySave(finishedRun);
  }
  setRunStatusIdle(statusItem);

  if (result.code === 0) {
    output.info(`${run.label} completed in ${result.elapsedMs}ms.`);
    await refreshConfigStatus(output, statusItem);
    vscode.window.showInformationMessage(`${run.label} completed.`);
  } else if (result.signal) {
    output.warn(`${run.label} stopped by signal ${result.signal}.`);
    await refreshConfigStatus(output, statusItem);
  } else {
    output.error(`${run.label} failed with exit code ${result.code}.`);
    await refreshConfigStatus(output, statusItem);
    vscode.window.showErrorMessage(`${run.label} failed. See Skippr output for details.`);
  }
  return result;
}

async function openModelWorkflowInAgentChat(
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem,
  requestedPipeline?: string,
  requestedConfigPath?: string,
  modelNoResume?: boolean
): Promise<void> {
  const skipModal = Boolean(requestedPipeline?.trim()) || Boolean(requestedConfigPath?.trim());
  let request: SkipprRunRequest | undefined;
  if (!skipModal) {
    request = await showRunConfigModal("model", output);
    if (!request) {
      return;
    }
  }

  const pipeline = requestedPipeline?.trim() || request?.pipeline?.trim();
  if (!pipeline) {
    vscode.window.showWarningMessage("Choose a pipeline for Skippr model.");
    return;
  }

  const configPath = requestedConfigPath?.trim() || request?.configPath?.trim() || activeConfigPath || (await chooseActiveConfig(output));
  if (!configPath) {
    vscode.window.showWarningMessage("No Skippr config found. Use Skippr: Setup Workspace first.");
    await showSetupWebview(output, statusItem);
    return;
  }
  if (!isWorkspaceRootConfigPath(configPath)) {
    vscode.window.showWarningMessage("Skippr commands require skippr.yml or skippr.yaml at the open workspace root.");
    return;
  }

  activeConfigPath = configPath;
  output.show(true);
  output.info(`Opening Skippr Agent chat to run model workflow for ${pipeline}.`);

  const prompt = `/model ${pipeline}${modelNoResume ? " --no-resume" : ""}`;

  await vscode.commands.executeCommand(`workbench.action.chat.openNewSessionSidebar.${SKIPPR_AGENT_HOST_SESSION_TYPE}`, {
    prompt,
    initialSessionOptions: {
      mode: "agent",
      pipeline,
      configPath
    }
  });
}

function registerAgentModelBridge(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem
): void {
  const processed = new Set<string>();
  const watchers = new Map<string, fs.FSWatcher>();

  const scanAll = () => {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const bridgeDir = agentBridgeDirForWorkspace(folder.uri.fsPath);
      ensureAgentBridgeDir(bridgeDir);
      if (!watchers.has(bridgeDir)) {
        try {
          watchers.set(
            bridgeDir,
            fs.watch(bridgeDir, () => scanAgentModelBridgeDir(bridgeDir, processed, output, statusItem))
          );
        } catch (error) {
          output.warn(`Unable to watch Skippr agent bridge: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      scanAgentModelBridgeDir(bridgeDir, processed, output, statusItem);
    }
  };

  scanAll();
  const interval = setInterval(scanAll, 1000);
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(scanAll),
    {
      dispose: () => {
        clearInterval(interval);
        for (const watcher of watchers.values()) {
          watcher.close();
        }
        watchers.clear();
      }
    }
  );
}

function ensureAgentBridgeDir(bridgeDir: string): void {
  fs.mkdirSync(bridgeDir, { recursive: true });
}

function agentBridgeDirForWorkspace(workspaceRoot: string): string {
  const digest = crypto.createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex").slice(0, 24);
  return path.join(os.tmpdir(), "skippr-ide-agent-bridge", digest);
}

function scanAgentModelBridgeDir(
  bridgeDir: string,
  processed: Set<string>,
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem
): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(bridgeDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".request.json")) {
      continue;
    }
    const requestPath = path.join(bridgeDir, entry);
    if (processed.has(requestPath)) {
      continue;
    }
    processed.add(requestPath);
    const request = readAgentModelRunRequest(requestPath);
    if (!request || request.kind !== "model") {
      continue;
    }
    void vscode.commands
      .executeCommand("skippr.internal.runModelForAgentChat", request, bridgeDir)
      .then(
        () => cleanupAgentBridgeRequest(requestPath),
        (error) => {
          appendAgentBridgeMessage(bridgeDir, request.id, {
            type: "complete",
            ok: false,
            errorDetail: error instanceof Error ? error.message : String(error),
            elapsedMs: 0
          });
          cleanupAgentBridgeRequest(requestPath);
        }
      );
  }
}

function readAgentModelRunRequest(requestPath: string): AgentModelRunRequest | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(requestPath, "utf8")) as AgentModelRunRequest;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function cleanupAgentBridgeRequest(requestPath: string): void {
  fs.rm(requestPath, { force: true }, () => undefined);
}

async function runAgentModelBridgeRequest(
  request: AgentModelRunRequest,
  bridgeDir: string,
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem
): Promise<void> {
  const requestId = request.id?.trim();
  const pipeline = request.pipeline?.trim();
  const configPath = request.configPath?.trim();
  if (!requestId || !pipeline || !configPath) {
    appendAgentBridgeMessage(bridgeDir, requestId, {
      type: "complete",
      ok: false,
      errorDetail: "Skippr Agent model bridge requires request id, pipeline, and configPath.",
      elapsedMs: 0
    });
    return;
  }

  const dbtOutputPath = path.join(getConfigCwd(configPath), pipeline, "dbt");
  const beforeSnapshot = snapshotDbtFiles(dbtOutputPath);
  appendAgentBridgeMessage(bridgeDir, requestId, {
    type: "accepted",
    pipeline,
    configPath,
    dbtOutputPath
  });

  await runSkipprCommand(
    "model",
    output,
    statusItem,
    pipeline,
    configPath,
    getLogLevel(),
    [],
    { modelNoResume: request.noResume === true },
    {
      onEvent: (event) => {
        appendAgentBridgeMessage(bridgeDir, requestId, { type: "event", event });
        appendDbtFileDiffMessages(bridgeDir, requestId, event, dbtOutputPath, beforeSnapshot);
      },
      onLog: (line) => {
        appendAgentBridgeMessage(bridgeDir, requestId, { type: "log", line });
      },
      onFinish: (result, finishedRun) => {
        appendAgentBridgeMessage(bridgeDir, requestId, {
          type: "complete",
          ok: result.code === 0 && !result.signal,
          code: result.code,
          signal: result.signal,
          elapsedMs: result.elapsedMs,
          errorDetail: result.errorDetail,
          changedFiles: finishedRun?.modelChangedFiles ?? []
        });
      }
    }
  );
}

function appendAgentBridgeMessage(bridgeDir: string, requestId: string | undefined, message: Record<string, unknown>): void {
  if (!requestId?.trim()) {
    return;
  }
  ensureAgentBridgeDir(bridgeDir);
  const responsePath = path.join(bridgeDir, `${requestId}.response.jsonl`);
  fs.appendFileSync(responsePath, `${JSON.stringify({ requestId, ...message })}\n`, "utf8");
}

function snapshotDbtFiles(dbtOutputPath: string): DbtFileSnapshot {
  const snapshot: DbtFileSnapshot = new Map();
  if (!fs.existsSync(dbtOutputPath)) {
    return snapshot;
  }
  for (const filePath of listFilesRecursively(dbtOutputPath)) {
    snapshot.set(filePath, readTextFileForDiff(filePath));
  }
  return snapshot;
}

function listFilesRecursively(root: string): string[] {
  const files: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const next = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(next));
    } else if (entry.isFile()) {
      files.push(next);
    }
  }
  return files;
}

function appendDbtFileDiffMessages(
  bridgeDir: string,
  requestId: string,
  event: SkipprRunEvent,
  dbtOutputPath: string,
  beforeSnapshot: DbtFileSnapshot
): void {
  if (event.event !== "model_file_changed" || !event.changed_files?.length) {
    return;
  }
  for (const changedFile of event.changed_files) {
    const absolutePath = modelChangedFileAbsolutePath(changedFile, dbtOutputPath);
    if (!absolutePath || !isPathInside(dbtOutputPath, absolutePath)) {
      continue;
    }
    const beforeContent = beforeSnapshot.get(absolutePath) ?? "";
    const afterContent = changedFile.change_kind === "deleted" ? "" : readTextFileForDiff(absolutePath);
    if (afterContent === undefined && changedFile.change_kind !== "deleted") {
      continue;
    }
    appendAgentBridgeMessage(bridgeDir, requestId, {
      type: "file_edit",
      filePath: absolutePath,
      changeKind: changedFile.change_kind ?? "modified",
      beforeContent,
      afterContent: afterContent ?? "",
      linesAdded: changedFile.lines_added,
      linesRemoved: changedFile.lines_removed
    });
  }
}

function modelChangedFileAbsolutePath(changedFile: SkipprModelChangedFile, dbtOutputPath: string): string | undefined {
  const raw = changedFile.absolute_path?.trim() || changedFile.path?.trim();
  if (!raw) {
    return undefined;
  }
  return path.resolve(path.isAbsolute(raw) ? raw : path.join(dbtOutputPath, raw));
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function readTextFileForDiff(filePath: string): string | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 500_000) {
      return undefined;
    }
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

interface SkipprQueryCliResult {
  ok?: boolean;
  pipeline?: string;
  sql?: string;
  answer?: string;
  data?: SkipprQueryData;
  chart?: SkipprQueryChart;
  elapsed_ms?: number;
  error?: string;
}

interface SkipprQueryContext {
  cliPath: string;
  configPath: string;
  pipeline: string;
}

interface SkipprLineageContext {
  cliPath: string;
  configPath: string;
  pipeline?: string;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function normalizeQueryData(value: unknown): SkipprQueryData | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as { header?: unknown; rows?: unknown };
  if (!isStringArray(candidate.header) || !Array.isArray(candidate.rows)) {
    return undefined;
  }
  const rows = candidate.rows
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((cell) => String(cell ?? "")));
  return { header: candidate.header, rows };
}

function normalizeQueryChart(value: unknown): SkipprQueryChart | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as { type?: unknown; x?: unknown; y?: unknown };
  const chartType = typeof candidate.type === "string" ? candidate.type : "";
  if (!chartType.trim() || typeof candidate.x !== "string" || !isStringArray(candidate.y)) {
    return undefined;
  }
  return { type: chartType, x: candidate.x, y: candidate.y };
}

function payloadFromQueryResult(result: SkipprQueryCliResult, fallback: Pick<SkipprQueryResultsPanelPayload, "source" | "pipeline" | "question">): SkipprQueryResultsPanelPayload {
  return {
    type: "queryResults",
    status: result.ok === false ? "error" : "success",
    source: fallback.source,
    pipeline: result.pipeline ?? fallback.pipeline,
    question: fallback.question,
    answer: result.answer,
    sql: result.sql,
    data: normalizeQueryData(result.data),
    chart: normalizeQueryChart(result.chart),
    elapsedMs: result.elapsed_ms,
    error: result.error
  };
}

function payloadFromAgentJsonLine(line: unknown, pipeline: string, question: string): SkipprQueryResultsPanelPayload | undefined {
  if (!line || typeof line !== "object") {
    return undefined;
  }
  const message = line as { type?: unknown; result?: unknown };
  if (message.type !== "final" || !message.result || typeof message.result !== "object") {
    return undefined;
  }
  const result = message.result as { kind?: unknown; payload?: unknown };
  if (result.kind !== "ask" || !result.payload || typeof result.payload !== "object") {
    return undefined;
  }
  const payload = result.payload as { answer?: unknown; sql?: unknown; data?: unknown; chart?: unknown };
  return {
    type: "queryResults",
    status: "success",
    source: "agent",
    pipeline,
    question,
    answer: typeof payload.answer === "string" ? payload.answer : undefined,
    sql: typeof payload.sql === "string" ? payload.sql : undefined,
    data: normalizeQueryData(payload.data),
    chart: normalizeQueryChart(payload.chart)
  };
}

async function resolveSqlQueryContext(output: vscode.LogOutputChannel): Promise<SkipprQueryContext | undefined> {
  const configPath = activeConfigPath || (await chooseActiveConfig(output));
  if (!configPath) {
    vscode.window.showWarningMessage("No Skippr config found. Use Skippr: Setup Workspace first.");
    return undefined;
  }
  if (!isWorkspaceRootConfigPath(configPath)) {
    vscode.window.showWarningMessage("Skippr SQL commands require skippr.yml or skippr.yaml at the open workspace root.");
    return undefined;
  }
  const cliPath = await resolveCliOrOfferInstall(output);
  if (!cliPath) {
    return undefined;
  }
  const show = await getConfigShow(output);
  const folderUri = workspaceFolderForConfigPath(configPath);
  const configuredDefault = vscode.workspace.getConfiguration("skippr", folderUri).get<string>(defaultPipelineKey, "").trim();
  const candidates = show?.pipelines?.length ? show.pipelines : configuredDefault ? [configuredDefault] : [];
  let pipeline = (show?.default_pipeline ?? configuredDefault).trim();
  if (!pipeline || (candidates.length > 0 && !candidates.includes(pipeline))) {
    if (candidates.length === 1) {
      pipeline = candidates[0];
    } else if (candidates.length > 1) {
      pipeline = (await vscode.window.showQuickPick(candidates, { placeHolder: "Select a Skippr pipeline for this query" })) ?? "";
    } else {
      pipeline = (await vscode.window.showInputBox({ prompt: "Pipeline name for this query" }))?.trim() ?? "";
    }
  }
  if (!pipeline) {
    return undefined;
  }
  return { cliPath, configPath, pipeline };
}

async function resolveSqlQueryContextQuiet(output: vscode.LogOutputChannel): Promise<SkipprQueryContext | undefined> {
  const configPath = activeConfigPath;
  if (!configPath || !isWorkspaceRootConfigPath(configPath)) {
    return undefined;
  }
  const config = vscode.workspace.getConfiguration();
  const cliPath = await resolveSkipprCli(config.get<string>(cliPathKey, ""));
  if (!cliPath) {
    return undefined;
  }
  const folderUri = workspaceFolderForConfigPath(configPath);
  const configuredDefault = vscode.workspace.getConfiguration("skippr", folderUri).get<string>(defaultPipelineKey, "").trim();
  const pipeline = configuredDefault;
  if (!pipeline) {
    return undefined;
  }
  return { cliPath, configPath, pipeline };
}

interface SkipprLineageCliResult {
  ok?: boolean;
  pipeline?: string;
  graph?: SkipprLineagePanelPayload["graph"];
  node_count?: number;
  edge_count?: number;
  diagnostic_count?: number;
  error?: string;
}

let activeLineagePanel: vscode.WebviewPanel | undefined;
let activeLineageContext: SkipprLineageContext | undefined;

function lineageBrandLogoUris(webview: vscode.Webview, extensionUri: vscode.Uri): Record<string, string> {
  const brandDir = vscode.Uri.joinPath(extensionUri, "media", "lineage-brands");
  return {
    s3: webview.asWebviewUri(vscode.Uri.joinPath(brandDir, "s3.svg")).toString(),
    snowflake: webview.asWebviewUri(vscode.Uri.joinPath(brandDir, "snowflake.svg")).toString()
  };
}

function postLineagePanel(payload: SkipprLineagePanelPayload): void {
  void activeLineagePanel?.webview.postMessage(payload);
}

function payloadFromLineageResult(
  result: SkipprLineageCliResult,
  fallback: Pick<SkipprLineagePanelPayload, "pipeline">
): SkipprLineagePanelPayload {
  return {
    type: "lineage",
    status: result.ok === false ? "error" : "success",
    pipeline: result.pipeline ?? fallback.pipeline,
    graph: result.graph,
    error: result.error
  };
}

async function runLineageCommand(
  ctx: SkipprLineageContext,
  output: vscode.LogOutputChannel,
  command: "graph" | "refresh" | "import-query-history"
): Promise<SkipprLineagePanelPayload> {
  if (command !== "graph" && !ctx.pipeline) {
    return {
      type: "lineage",
      status: "error",
      pipeline: "all pipelines",
      error: "Choose a specific pipeline before refreshing lineage or importing query history."
    };
  }
  const args = ["--config", ctx.configPath, "--log", getLogLevel(), "lineage", command];
  if (ctx.pipeline) {
    args.push("--pipeline", ctx.pipeline);
  }
  args.push("--output", "json");
  const result = await runSkipprJson<SkipprLineageCliResult>(
    ctx.cliPath,
    args,
    getConfigCwd(ctx.configPath),
    output,
    skipprSpawnEnv(ctx.configPath, ctx.pipeline),
    ctx.configPath
  );
  if (!result.value) {
    return {
      type: "lineage",
      status: "error",
      pipeline: ctx.pipeline ?? "all pipelines",
      error: result.stdout || "Lineage command failed before producing JSON output."
    };
  }
  return payloadFromLineageResult(result.value, { pipeline: ctx.pipeline ?? "all pipelines" });
}

async function resolveLineageContext(
  output: vscode.LogOutputChannel,
  requested?: { configPath?: string; pipeline?: string }
): Promise<SkipprLineageContext | undefined> {
  const configPath = requested?.configPath?.trim() || activeConfigPath || (await chooseActiveConfig(output));
  if (!configPath) {
    vscode.window.showWarningMessage("No Skippr config found. Use Skippr: Setup Workspace first.");
    return undefined;
  }
  if (!isWorkspaceRootConfigPath(configPath)) {
    vscode.window.showWarningMessage("Skippr lineage requires skippr.yml or skippr.yaml at the open workspace root.");
    return undefined;
  }
  const cliPath = await resolveCliOrOfferInstall(output);
  if (!cliPath) {
    return undefined;
  }
  return { cliPath, configPath, pipeline: requested?.pipeline?.trim() || undefined };
}

async function openLineagePanel(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
  requested?: { configPath?: string; pipeline?: string }
): Promise<void> {
  const ctx = await resolveLineageContext(output, requested);
  if (!ctx) {
    return;
  }
  activeLineageContext = ctx;
  if (activeLineagePanel) {
    activeLineagePanel.reveal(vscode.ViewColumn.Active);
  } else {
    activeLineagePanel = vscode.window.createWebviewPanel(
      "skippr.lineage",
      "Skippr Lineage",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")]
      }
    );
    activeLineagePanel.webview.html = renderSkipprLineagePanelHtml({
      cspSource: activeLineagePanel.webview.cspSource,
      brandLogoUris: lineageBrandLogoUris(activeLineagePanel.webview, context.extensionUri)
    });
    activeLineagePanel.webview.onDidReceiveMessage((message: { command?: string }) => {
      if (message.command === "refresh") {
        void refreshLineagePanel(output, "refresh");
      } else if (message.command === "importHistory") {
        void refreshLineagePanel(output, "import-query-history");
      }
    });
    activeLineagePanel.onDidDispose(() => {
      activeLineagePanel = undefined;
      activeLineageContext = undefined;
    });
  }
  await refreshLineagePanel(output, "graph");
}

async function refreshLineagePanel(
  output: vscode.LogOutputChannel,
  command: "graph" | "refresh" | "import-query-history"
): Promise<void> {
  const ctx = activeLineageContext;
  if (!ctx) {
    return;
  }
  postLineagePanel({
    type: "lineage",
    status: "running",
    pipeline: ctx.pipeline
  });
  const payload = await runLineageCommand(ctx, output, command);
  postLineagePanel(payload);
  if (command !== "graph" && payload.status === "success") {
    const graphPayload = await runLineageCommand(ctx, output, "graph");
    postLineagePanel(graphPayload);
  }
}

function activeSqlDocumentText(selectionOnly: boolean): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Open a SQL editor before running a query.");
    return undefined;
  }
  if (selectionOnly && !editor.selection.isEmpty) {
    return editor.document.getText(editor.selection).trim();
  }
  return editor.document.getText().trim();
}

let dbtEditorRunMode: DbtEditorRunMode = "sql";
let dbtContextRefreshTimer: ReturnType<typeof setTimeout> | undefined;

async function runWarehouseSqlQuery(
  ctx: SkipprQueryContext,
  sql: string,
  output: vscode.LogOutputChannel,
  source: "sql" | "dbt"
): Promise<void> {
  postQueryResults({
    type: "queryResults",
    status: "running",
    source,
    pipeline: ctx.pipeline,
    sql
  });
  await showQueryResultsPanel();
  const result = await runSkipprJson<SkipprQueryCliResult>(
    ctx.cliPath,
    ["--config", ctx.configPath, "--log", getLogLevel(), "query", "--pipeline", ctx.pipeline, `--sql=${sql}`, "--output", "json"],
    getConfigCwd(ctx.configPath),
    output,
    skipprSpawnEnv(ctx.configPath, ctx.pipeline),
    ctx.configPath
  );
  const payload = result.value
    ? payloadFromQueryResult(result.value, { source, pipeline: ctx.pipeline })
    : {
        type: "queryResults" as const,
        status: "error" as const,
        source,
        pipeline: ctx.pipeline,
        sql,
        error: result.stdout || "Query failed before producing JSON output."
      };
  postQueryResults(payload);
  await showQueryResultsPanel();
}

async function runDbtDocument(
  output: vscode.LogOutputChannel,
  runStatusItem: vscode.StatusBarItem
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Open a dbt SQL file before running.");
    return;
  }
  const detected = detectDbtSqlFile(editor.document.uri);
  if (!detected.isDbt) {
    vscode.window.showWarningMessage("This file is not a dbt SQL model.");
    return;
  }
  if (detected.layoutError) {
    vscode.window.showErrorMessage(detected.layoutError);
    return;
  }
  const ctx = await resolveSqlQueryContext(output);
  if (!ctx) {
    return;
  }
  const dbtCtx = detected.pipelineFromPath ? { ...ctx, pipeline: detected.pipelineFromPath } : ctx;
  const dbtFilePath = detected.filePath;
  const cwd = getConfigCwd(dbtCtx.configPath);
  const env = skipprSpawnEnv(dbtCtx.configPath, dbtCtx.pipeline);
  if (dbtEditorRunMode === "tests") {
    const meta = await probeDbtFileMeta(
      dbtCtx.cliPath,
      dbtCtx.configPath,
      dbtCtx.pipeline,
      dbtFilePath,
      cwd,
      output,
      env,
      true
    );
    const testSelect = meta?.test_select?.trim() || meta?.model_name?.trim() || "";
    if (!testSelect) {
      vscode.window.showErrorMessage("Could not resolve a dbt model name for tests on this file.");
      return;
    }
    await runSkipprTestFromCliPanel(output, runStatusItem, {
      configPath: dbtCtx.configPath,
      pipeline: dbtCtx.pipeline,
      logLevel: getLogLevel(),
      testSelect,
      extraArgsText: vscode.workspace.getConfiguration("skippr").get<string>(runExtraArgsKey, "")
    });
    return;
  }
  postQueryResults({
    type: "queryResults",
    status: "running",
    source: "dbt",
    pipeline: dbtCtx.pipeline,
    sql: "-- compiling dbt model…"
  });
  await showQueryResultsPanel();
  const compiled = await compileDbtSqlForQuery(
    dbtCtx.cliPath,
    dbtCtx.configPath,
    dbtCtx.pipeline,
    dbtFilePath,
    cwd,
    output,
    env
  );
  if (!compiled.ok) {
    postQueryResults({
      type: "queryResults",
      status: "error",
      source: "dbt",
      pipeline: dbtCtx.pipeline,
      error: compiled.error
    });
    await showQueryResultsPanel();
    vscode.window.showErrorMessage(compiled.error);
    return;
  }
  await runWarehouseSqlQuery(dbtCtx, compiled.sql, output, "dbt");
}

async function runSqlTextFromEditor(
  selectionOnly: boolean,
  output: vscode.LogOutputChannel,
  runStatusItem: vscode.StatusBarItem
): Promise<void> {
  if (!selectionOnly) {
    const editor = vscode.window.activeTextEditor;
    if (editor && detectDbtSqlFile(editor.document.uri).isDbt) {
      await runDbtDocument(output, runStatusItem);
      return;
    }
  }
  const sql = activeSqlDocumentText(selectionOnly);
  if (!sql) {
    vscode.window.showWarningMessage("No SQL found to run.");
    return;
  }
  const ctx = await resolveSqlQueryContext(output);
  if (!ctx) {
    return;
  }
  await runWarehouseSqlQuery(ctx, sql, output, "sql");
}

function scheduleDbtEditorContextRefresh(output: vscode.LogOutputChannel): void {
  if (dbtContextRefreshTimer) {
    clearTimeout(dbtContextRefreshTimer);
  }
  dbtContextRefreshTimer = setTimeout(() => {
    dbtContextRefreshTimer = undefined;
    void refreshDbtEditorContextKeys(vscode.window.activeTextEditor, {
      getRunMode: () => dbtEditorRunMode,
      probeHasTests: async (_filePath) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== "sql") {
          return false;
        }
        const ctx = await resolveSqlQueryContextQuiet(output);
        if (!ctx) {
          return false;
        }
        const detected = detectDbtSqlFile(editor.document.uri);
        if (detected.layoutError) {
          return false;
        }
        const pipeline = detected.pipelineFromPath ?? ctx.pipeline;
        return probeDbtFileHasTests(
          ctx.cliPath,
          ctx.configPath,
          pipeline,
          detected.filePath,
          getConfigCwd(ctx.configPath),
          output,
          skipprSpawnEnv(ctx.configPath, pipeline)
        );
      }
    });
  }, 600);
}

async function askDataQuestion(output: vscode.LogOutputChannel): Promise<void> {
  const question = (await vscode.window.showInputBox({ prompt: "Ask a data question", placeHolder: "e.g. Which customers drove revenue last month?" }))?.trim();
  if (!question) {
    return;
  }
  const ctx = await resolveSqlQueryContext(output);
  if (!ctx) {
    return;
  }
  postQueryResults({
    type: "queryResults",
    status: "running",
    source: "agent",
    pipeline: ctx.pipeline,
    question
  });
  await showQueryResultsPanel();
  const message = JSON.stringify({
    user: question,
    execution_surface: "ide_chat",
    context: { surface: "sql_results_panel" }
  });
  const tokenSource = new vscode.CancellationTokenSource();
  try {
    const result = await runSkipprJsonLines(
      ctx.cliPath,
      ["--config", ctx.configPath, "--log", getLogLevel(), "chat", "send", "--pipeline", ctx.pipeline, "--mode", "ask", "--message", message, "--output", "jsonl"],
      getConfigCwd(ctx.configPath),
      output,
      tokenSource.token,
      skipprSpawnEnv(ctx.configPath, ctx.pipeline)
    );
    const finalPayload = (result.lines as unknown[])
      .map((line) => payloadFromAgentJsonLine(line, ctx.pipeline, question))
      .find((payload): payload is SkipprQueryResultsPanelPayload => Boolean(payload));
    postQueryResults(
      finalPayload ?? {
        type: "queryResults",
        status: "error",
        source: "agent",
        pipeline: ctx.pipeline,
        question,
        error: result.stderr || "Agent finished without returning a SQL result."
      }
    );
    await showQueryResultsPanel();
  } finally {
    tokenSource.dispose();
  }
}

async function newSqlQueryDocument(): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    language: "sql",
    content: "-- Write a read-only SELECT query, then run Skippr: Run SQL Document.\nselect *\nfrom \nlimit 50;\n"
  });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
}

function normalizeDiscoverOutput(raw: unknown): string | undefined {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s === "progress" || s === "json" || s === "text") {
    return s;
  }
  return undefined;
}

async function executeRunDebugPanelRun(
  message: {
    command?: string;
    logLevel?: string;
    pipeline?: string;
    /** When set (e.g. CodeLens on this file), use this config instead of resolveSkipprConfigAtCwd(). */
    configPath?: string;
    testSelect?: string;
    extraArgs?: string;
    syncMode?: "once" | "stream";
    discoverOutput?: string;
    modelNoResume?: boolean;
  },
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem
): Promise<void> {
  const cmd = (message.command ?? "").trim();
  const fromEditor = typeof message.configPath === "string" ? message.configPath.trim() : "";
  const configPath = fromEditor || (await resolveSkipprConfigAtCwd()).trim();
  const logLevel = (message.logLevel ?? "").trim() || getLogLevel();
  const pipeline = (message.pipeline ?? "").trim();
  const extraCliArgs = parseShellArgs(
    typeof message.extraArgs === "string" && message.extraArgs.trim()
      ? message.extraArgs
      : vscode.workspace.getConfiguration().get<string>(runExtraArgsKey, "").trim()
  );
  const syncMode = message.syncMode === "stream" ? "stream" : "once";

  output.show(true);
  if (fromEditor) {
    activeConfigPath = fromEditor;
  }

  if (!configPath) {
    vscode.window.showWarningMessage("No skippr.yml or skippr.yaml next to the Skippr working directory. Check run CWD or use Setup Workspace.");
    return;
  }

  if (cmd === "doctor") {
    await runSkipprDoctor(output, statusItem, configPath, { logLevel, extraCliArgs });
    return;
  }
  if (cmd === "sync-all") {
    await runSkipprCommand("sync-all-once", output, statusItem, undefined, configPath, logLevel, extraCliArgs);
    return;
  }
  if (cmd === "test") {
    if (!pipeline) {
      vscode.window.showWarningMessage("Choose a pipeline for Skippr test.");
      return;
    }
    await runSkipprTestFromCliPanel(output, statusItem, {
      configPath,
      pipeline,
      logLevel,
      testSelect: typeof message.testSelect === "string" ? message.testSelect : "",
      extraArgsText: typeof message.extraArgs === "string" ? message.extraArgs : ""
    });
    return;
  }
  if (cmd === "sync") {
    if (!pipeline) {
      vscode.window.showWarningMessage("Choose a pipeline for Skippr sync.");
      return;
    }
    const kind = syncMode === "stream" ? "sync" : "sync-once";
    await runSkipprCommand(kind, output, statusItem, pipeline, configPath, logLevel, extraCliArgs);
    return;
  }
  if (cmd === "discover") {
    if (!pipeline) {
      vscode.window.showWarningMessage("Choose a pipeline for Skippr discover.");
      return;
    }
    const discoverOutput = normalizeDiscoverOutput(message.discoverOutput);
    await runSkipprCommand("discover", output, statusItem, pipeline, configPath, logLevel, extraCliArgs, {
      discoverOutput
    });
    return;
  }
  if (cmd === "model") {
    if (!pipeline) {
      vscode.window.showWarningMessage("Choose a pipeline for Skippr model.");
      return;
    }
    await openModelWorkflowInAgentChat(output, statusItem, pipeline, configPath, message.modelNoResume === true);
    return;
  }
  vscode.window.showErrorMessage(`Unknown Skippr panel command: ${cmd || "(empty)"}`);
}

async function runVectorIngestOnOpen(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem
): Promise<void> {
  const configPath = activeConfigPath || (await chooseActiveConfig(output));
  const folder = configPath ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(configPath)) : vscode.workspace.workspaceFolders?.[0];
  if (!configPath || !folder) {
    return;
  }
  const stateKey = `${vectorOnOpenStateKey}:${configPath}:${folder.uri.fsPath}`;
  if (context.globalState.get<boolean>(stateKey)) {
    return;
  }
  await context.globalState.update(stateKey, true);

  const cliPath = await resolveSkipprCli(vscode.workspace.getConfiguration().get<string>(cliPathKey, ""));
  if (!cliPath) {
    output.info("Skipping automatic Skippr vector ingest: CLI not configured.");
    return;
  }

  const args = [
    "--config",
    configPath,
    "vector",
    "ingest-docs",
    "--pipeline",
    "vector_ingest",
    "--src-path",
    folder.uri.fsPath,
    "--include-glob",
    "**/*",
    "--output",
    "json",
    ...vectorOnOpenExcludeGlobs.flatMap((glob) => ["--exclude-glob", glob])
  ];

  const headline = "Vector ingest";
  output.info(`Starting automatic Skippr vector ingest for ${folder.uri.fsPath}.`);
  setRunStatusRunning(statusItem, headline);
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Indexing workspace for Skippr chat",
        cancellable: false
      },
      async (progress) => {
        progress.report({ message: "Scanning project files and applying excludes..." });
        const run = await runSkipprJson<unknown>(
          cliPath,
          args,
          getConfigCwd(configPath),
          output,
          skipprSpawnEnv(configPath, "vector_ingest"),
          configPath
        );
        progress.report({ message: "Finalizing vector index..." });
        return run;
      }
    );
    const ok = result.code === 0;
    finishRunStatusPanel({
      headline,
      code: result.code,
      signal: result.signal,
      elapsedMs: result.elapsedMs,
      logicalOk: ok,
      detail: ok ? "Workspace vector index refreshed." : "Vector ingest skipped or failed — see output."
    });
    if (ok) {
      output.info("Automatic Skippr vector ingest completed.");
    } else {
      output.warn("Automatic Skippr vector ingest skipped or failed. Ensure skippr.yml defines pipelines.vector_ingest and vector_sources.");
    }
  } finally {
    setRunStatusIdle(statusItem);
  }
}

async function runLensPipelineCommand(
  command: SkipprPipelineRunCommand,
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem
): Promise<void> {
  const ctx = takePendingPipelineLensRun();
  if (!ctx) {
    vscode.window.showErrorMessage("Skippr: no pipeline run context. Click a run action on a pipeline in skippr.yml.");
    return;
  }
  await runLensPipelineWithArgs(ctx.configPath, ctx.pipeline, command, context, output, statusItem);
}

async function runLensPipelineWithArgs(
  configFsPath: unknown,
  pipeline: unknown,
  command: unknown,
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem
): Promise<void> {
  if (typeof configFsPath !== "string" || typeof pipeline !== "string" || !pipeline.trim()) {
    vscode.window.showErrorMessage("Skippr: missing pipeline or config path.");
    return;
  }
  const cmd = command as SkipprPipelineRunCommand;
  if (cmd !== "discover" && cmd !== "sync" && cmd !== "model" && cmd !== "doctor" && cmd !== "lineage") {
    vscode.window.showErrorMessage("Skippr: unknown run action.");
    return;
  }
  if (cmd === "lineage") {
    await openLineagePanel(context, output, {
      configPath: configFsPath.trim(),
      pipeline: pipeline.trim()
    });
    return;
  }
  const wsExtra = vscode.workspace.getConfiguration().get<string>(runExtraArgsKey, "").trim();
  await executeRunDebugPanelRun(
    {
      command: cmd,
      pipeline: pipeline.trim(),
      configPath: configFsPath.trim(),
      logLevel: getLogLevel(),
      extraArgs: wsExtra,
      syncMode: "once",
      discoverOutput: "json",
      modelNoResume: false
    },
    output,
    statusItem
  );
}

async function runPickPipelineAction(
  configFsPath: unknown,
  pipeline: unknown,
  line: unknown,
  output: vscode.LogOutputChannel,
  _statusItem: vscode.StatusBarItem
): Promise<boolean> {
  if (typeof configFsPath !== "string" || typeof pipeline !== "string" || !pipeline.trim()) {
    vscode.window.showErrorMessage("Skippr: missing pipeline or config path.");
    return false;
  }
  const lineIndex = typeof line === "number" && Number.isFinite(line) ? line : 0;
  await openSkipprPipelineRunMenu(configFsPath.trim(), pipeline.trim(), lineIndex);
  return true;
}

async function runSkipprTestFromCliPanel(
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem,
  opts: { configPath: string; pipeline: string; logLevel: string; testSelect: string; extraArgsText: string }
): Promise<void> {
  if (!isWorkspaceRootConfigPath(opts.configPath)) {
    vscode.window.showWarningMessage("Skippr commands require skippr.yml or skippr.yaml at the open workspace root.");
    return;
  }
  const cliPath = await resolveCliOrOfferInstall(output);
  if (!cliPath) {
    return;
  }
  const cwd = getConfigCwd(opts.configPath);
  const args = [
    "--config",
    opts.configPath,
    "--log",
    opts.logLevel?.trim() || "info",
    "test",
    "run",
    "--pipeline",
    opts.pipeline.trim(),
    "--output",
    "jsonl"
  ];
  if (opts.testSelect.trim()) {
    args.push("--select", opts.testSelect.trim());
  }
  args.push(...parseShellArgs(opts.extraArgsText));
  output.show(true);
  setRunStatusRunning(statusItem, `Test ${opts.pipeline.trim()}`);
  const testStartedAt = Date.now();
  const cts = new vscode.CancellationTokenSource();
  try {
    const { code, stderr, stdout } = await runSkipprJsonLines(
      cliPath,
      args,
      cwd,
      output,
      cts.token,
      skipprSpawnEnv(opts.configPath, opts.pipeline.trim())
    );
    const elapsedMs = Date.now() - testStartedAt;
    const headline = `Test ${opts.pipeline.trim()}`;
    if (code === 0) {
      output.info(`skippr test run completed for ${opts.pipeline}.`);
      if (stdout.trim()) {
        const tail = stdout.trimEnd();
        output.info(tail.length > 8000 ? `${tail.slice(-8000)}\n… (truncated)` : tail);
      }
      vscode.window.showInformationMessage(`dbt tests finished for ${opts.pipeline}.`);
    } else {
      output.error(`skippr test run failed (exit ${code ?? "?"}).\n${stderr}\n${stdout}`);
      vscode.window.showErrorMessage("skippr test run failed. See Skippr output.");
    }
    finishRunStatusPanel({
      headline,
      code,
      signal: null,
      elapsedMs,
      detail: code === 0 ? "dbt tests completed." : "dbt tests failed — see output."
    });
  } finally {
    cts.dispose();
    setRunStatusIdle(statusItem);
  }
}

async function runSkipprDebugConfiguration(
  configuration: vscode.DebugConfiguration,
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem
): Promise<void> {
  const rawKind = configuration.skipprKind;
  const skipprKind = rawKind === "sync" ? "sync-once" : rawKind;

  const extraFromLaunch =
    typeof configuration.skipprExtraArgs === "string"
      ? parseShellArgs(configuration.skipprExtraArgs)
      : typeof configuration.extraArgs === "string"
        ? parseShellArgs(configuration.extraArgs)
        : [];

  const logLevelResolved =
    typeof configuration.logLevel === "string" && configuration.logLevel.trim()
      ? configuration.logLevel.trim()
      : getLogLevel();

  if (skipprKind === "test") {
    const configPath = typeof configuration.configPath === "string" ? configuration.configPath.trim() : "";
    const pipeline = typeof configuration.pipeline === "string" ? configuration.pipeline.trim() : "";
    if (!configPath || !pipeline) {
      vscode.window.showErrorMessage("Skippr test launch needs configPath and pipeline.");
      return;
    }
    const testSelectRaw =
      typeof configuration.skipprTestSelect === "string"
        ? configuration.skipprTestSelect
        : typeof configuration.testSelect === "string"
          ? configuration.testSelect
          : "";
    const extraArgsText =
      typeof configuration.skipprExtraArgs === "string"
        ? configuration.skipprExtraArgs
        : typeof configuration.extraArgs === "string"
          ? configuration.extraArgs
          : "";
    await runSkipprTestFromCliPanel(output, statusItem, {
      configPath,
      pipeline,
      logLevel: logLevelResolved,
      testSelect: testSelectRaw,
      extraArgsText
    });
    return;
  }
  if (skipprKind === "doctor") {
    const configPath = typeof configuration.configPath === "string" ? configuration.configPath : undefined;
    await runSkipprDoctor(output, statusItem, configPath, { logLevel: logLevelResolved, extraCliArgs: extraFromLaunch });
    return;
  }
  if (!isSkipprRunKind(skipprKind)) {
    output.error(`Invalid Skippr debug configuration kind: ${String(rawKind)}`);
    vscode.window.showErrorMessage(
      "Invalid Skippr debug configuration. Expected skipprKind discover, sync-once, sync-all-once, sync, model, doctor, or test."
    );
    return;
  }
  const kind = skipprKind;
  if (kind !== "sync-all-once" && !String(configuration.pipeline ?? "").trim()) {
    vscode.window.showErrorMessage("Skippr debug configuration needs a pipeline (set skippr.defaultPipeline or add a pipeline in skippr.yml).");
    return;
  }
  const pipeline = typeof configuration.pipeline === "string" ? configuration.pipeline : undefined;
  const configPath = typeof configuration.configPath === "string" ? configuration.configPath : undefined;
  await runSkipprCommand(kind, output, statusItem, pipeline, configPath, logLevelResolved, extraFromLaunch);
}

function stopActiveRun(statusItem: vscode.StatusBarItem, output: vscode.LogOutputChannel): void {
  if (!activeRun) {
    vscode.window.showInformationMessage("No Skippr run is active.");
    return;
  }
  output.info(`Stopping ${activeRun.label}...`);
  activeRun.stop();
  setRunStatusIdle(statusItem);
}

async function openActiveConfig(output: vscode.LogOutputChannel): Promise<void> {
  const cwdConfig = (await resolveSkipprConfigAtCwd()).trim();
  const configPath = cwdConfig || activeConfigPath?.trim() || (await chooseActiveConfig(output));
  if (!configPath) {
    vscode.window.showWarningMessage("No Skippr config found.");
    return;
  }
  await vscode.window.showTextDocument(vscode.Uri.file(configPath));
}

interface InitCommandResult {
  ok: boolean;
  config_path?: string;
  project?: string;
}

async function showSetupWebview(output: vscode.LogOutputChannel, statusItem: vscode.StatusBarItem): Promise<void> {
  const openOptions: vscode.OpenDialogOptions & { canCreateDirectories?: boolean } = {
    title: "Choose or create a folder for this Skippr project",
    openLabel: "Use Folder",
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    canCreateDirectories: true,
    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
  };
  const selected = await vscode.window.showOpenDialog(openOptions);
  const folder = selected?.[0];
  if (!folder) {
    return;
  }

  const defaultName = path.basename(folder.fsPath);
  const name = await vscode.window.showInputBox({
    title: "Skippr Project Name",
    prompt: "Enter the Skippr project name to initialize in the selected folder.",
    value: defaultName,
    validateInput: (value) => (value.trim() ? undefined : "Project name is required.")
  });
  if (!name?.trim()) {
    return;
  }

  const cliPath = await resolveCliOrOfferInstall(output);
  if (!cliPath) {
    return;
  }

  output.show(true);
  const initHeadline = `Initializing ${name.trim()}`;
  setRunStatusRunning(statusItem, initHeadline);
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Initializing Skippr project ${name.trim()}`,
      cancellable: false
    },
    () =>
      runSkipprJson<InitCommandResult>(
        cliPath,
        ["--config", path.join(folder.fsPath, "skippr.yml"), "init", name.trim(), "--output", "json"],
        folder.fsPath,
        output,
        mergeSkipprSpawnEnv(process.env, folder, undefined, path.join(folder.fsPath, "skippr.yml")),
        path.join(folder.fsPath, "skippr.yml")
      )
  );
  const initOk = result.code === 0 && Boolean(result.value?.ok);
  finishRunStatusPanel({
    headline: initHeadline,
    code: result.code,
    signal: result.signal,
    elapsedMs: result.elapsedMs,
    logicalOk: initOk,
    detail: initOk ? `Project “${name.trim()}” created.` : "init failed — see output."
  });
  setRunStatusIdle(statusItem);
  if (result.code !== 0 || !result.value?.ok) {
    vscode.window.showErrorMessage("Skippr initialization failed. See Skippr output for details.");
    return;
  }

  await vscode.workspace.getConfiguration().update(workspacePathKey, folder.fsPath, vscode.ConfigurationTarget.Global);
  activeConfigPath = result.value.config_path || path.join(folder.fsPath, "skippr.yml");
  await refreshConfigStatus(output, statusItem);
  vscode.window.showInformationMessage(`Skippr project ${result.value.project ?? name.trim()} initialized.`);
  await vscode.commands.executeCommand("vscode.openFolder", folder, false);
}

async function saveAuthSession(context: vscode.ExtensionContext, session: AuthSession): Promise<void> {
  await context.secrets.store(authTokenKey, session.token);
  await context.secrets.store(authRefreshTokenKey, session.refreshToken);
  await context.secrets.store(authEmailKey, session.email);
  const written = await writeSkipprCliCredentialsFile({
    access_token: session.token,
    refresh_token: session.refreshToken
  });
  if (!written.ok) {
    vscode.window.showWarningMessage(
      `Skippr could not sync CLI credentials to ~/.skippr/credentials.json: ${written.message}`
    );
  }
}

async function readAuthSession(context: vscode.ExtensionContext): Promise<AuthSession | undefined> {
  const token = await context.secrets.get(authTokenKey);
  const refreshToken = await context.secrets.get(authRefreshTokenKey);
  const email = await context.secrets.get(authEmailKey);
  if (!token || !refreshToken || !email) {
    return undefined;
  }
  return { token, refreshToken, email };
}

async function clearAuthSession(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(authTokenKey);
  await context.secrets.delete(authRefreshTokenKey);
  await context.secrets.delete(authEmailKey);
  await clearSkipprCliCredentialsFile();
}

async function apiRequest(path: string, method: string, body?: unknown, token?: string): Promise<Response> {
  return fetch(`${getAuthBaseUrl()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

/** Returns null when the request fails before a response (e.g. offline); does not throw. */
async function tryApiRequest(path: string, method: string, body?: unknown, token?: string): Promise<Response | null> {
  try {
    return await apiRequest(path, method, body, token);
  } catch {
    return null;
  }
}

function applySignedInAuthStatusBar(statusItem: vscode.StatusBarItem, email: string, tooltip?: string): void {
  statusItem.text = `$(account) ${email}`;
  statusItem.tooltip = tooltip ?? "Signed in to Skippr";
  statusItem.command = "skippr.auth.account";
}

function applySignedOutAuthStatusBar(statusItem: vscode.StatusBarItem): void {
  statusItem.text = "$(sign-in) Skippr Sign In";
  statusItem.tooltip = "Sign in to Skippr";
  statusItem.command = "skippr.auth.account";
}

async function syncAuthStatusBarFromStoredSecrets(context: vscode.ExtensionContext, statusItem: vscode.StatusBarItem): Promise<void> {
  const stored = await readAuthSession(context);
  if (stored) {
    applySignedInAuthStatusBar(statusItem, stored.email, "Signed in to Skippr (validating…)");
  } else {
    applySignedOutAuthStatusBar(statusItem);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function signIn(
  context: vscode.ExtensionContext,
  statusItem: vscode.StatusBarItem,
  authProvider: SkipprAuthenticationProvider,
  suppressProviderSessionEvent = false
): Promise<AuthSession | undefined> {
  const raw = await runEmailOtpAuthQuickInput({ apiRequest });
  if (!raw) {
    return undefined;
  }
  const session: AuthSession = { token: raw.token, refreshToken: raw.refreshToken, email: raw.email };
  await saveAuthSession(context, session);
  applySignedInAuthStatusBar(statusItem, session.email);
  if (!suppressProviderSessionEvent) {
    authProvider.notifySessionCreated(session);
  }
  return session;
}

async function fetchAccount(session: AuthSession): Promise<SkipprAccountPayload | undefined> {
  const response = await apiRequest("/account", "GET", undefined, session.token);
  return response.ok ? ((await response.json()) as SkipprAccountPayload) : undefined;
}

function renderAccountOverlayHtml(session: AuthSession | undefined, account: SkipprAccountPayload | undefined): string {
  const plan = account?.profile?.plan ?? "Unknown";
  const balance = account?.balance?.balance ?? 0;
  const estimate = account?.monthly_cost_est ?? 0;
  const eula = account?.eula?.accepted_at
    ? `Accepted ${account.eula.accepted_at}`
    : account?.eula?.version ?? "Not accepted";
  const signedIn = session ? `Signed in as ${session.email}` : "Not signed in";
  const accountBody = session
    ? `
      <div class="grid">
        <section class="metric"><span>Plan</span><strong>${escapeHtml(plan)}</strong></section>
        <section class="metric"><span>Balance</span><strong>$${balance.toFixed(2)}</strong></section>
        <section class="metric"><span>Month estimate</span><strong>$${estimate.toFixed(2)}</strong></section>
        <section class="metric"><span>EULA</span><strong>${escapeHtml(eula)}</strong></section>
      </div>
      ${account ? "" : `<p class="warning">Could not load account details from Skippr. You can refresh or sign in again.</p>`}
      <div class="actions">
        <button data-action="refresh">Refresh</button>
        <button data-action="buyCredits">Buy credits</button>
        <button data-action="acceptEula">Accept EULA</button>
        <button data-action="signOut" class="secondary">Sign out</button>
      </div>`
    : `
      <p class="copy">Sign in to connect Skippr Data Agent chat, account, billing, and CLI credentials to the same Skippr session.</p>
      <div class="actions"><button data-action="signIn">Sign in to Skippr</button></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: var(--vscode-foreground); background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent); font-family: var(--vscode-font-family); }
    .card { width: min(640px, calc(100vw - 48px)); padding: 28px; border: 1px solid var(--vscode-panel-border); border-radius: 18px; background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-sideBar-background)); box-shadow: 0 18px 60px rgba(0,0,0,.28); }
    .eyebrow { color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: .12em; font-size: 12px; }
    h1 { margin: 6px 0 8px; font-size: 24px; }
    .status, .copy, .warning { color: var(--vscode-descriptionForeground); line-height: 1.5; }
    .warning { color: var(--vscode-inputValidation-warningForeground); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 22px 0; }
    .metric { padding: 14px; border: 1px solid var(--vscode-panel-border); border-radius: 12px; background: color-mix(in srgb, var(--vscode-editor-background) 80%, var(--vscode-input-background)); }
    .metric span { display: block; color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 6px; }
    .metric strong { font-size: 18px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
    button { border: 0; border-radius: 6px; padding: 8px 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  </style>
</head>
<body>
  <main class="card">
    <div class="eyebrow">Skippr Account</div>
    <h1>Data Agent session</h1>
    <p class="status">${escapeHtml(signedIn)}</p>
    ${accountBody}
  </main>
  <script>
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (button) {
        vscode.postMessage({ command: button.dataset.action });
      }
    });
  </script>
</body>
</html>`;
}

async function showAccount(
  context: vscode.ExtensionContext,
  statusItem: vscode.StatusBarItem,
  authProvider: SkipprAuthenticationProvider
): Promise<void> {
  const panel = vscode.window.createWebviewPanel("skippr.account", "Skippr Account", vscode.ViewColumn.Active, {
    enableScripts: true
  });

  const refresh = async () => {
    const session = await ensureSession(context, statusItem, authProvider);
    const account = session ? await fetchAccount(session) : undefined;
    panel.webview.html = renderAccountOverlayHtml(session, account);
  };

  panel.webview.onDidReceiveMessage(async (message: { command?: string }) => {
    const session = await readAuthSession(context);
    if (message.command === "signIn") {
      await signIn(context, statusItem, authProvider);
      await refresh();
      return;
    }
    if (!session) {
      await refresh();
      return;
    }
    if (message.command === "refresh") {
      await refresh();
      return;
    }
    if (message.command === "buyCredits") {
      const amount = await vscode.window.showInputBox({ title: "Buy Skippr Credits", prompt: "Amount in USD", value: "25" });
      const parsed = Number(amount);
      if (Number.isFinite(parsed) && parsed >= 5) {
        const response = await apiRequest("/account/buy-credits", "POST", { amount: parsed }, session.token);
        if (response.ok) {
          const payload = (await response.json()) as { checkout_url?: string };
          if (payload.checkout_url) {
            await vscode.env.openExternal(vscode.Uri.parse(payload.checkout_url));
          }
        }
      }
      await refresh();
      return;
    }
    if (message.command === "acceptEula") {
      await apiRequest("/auth/accept-eula", "POST", { version: "skippr-eula-2026-04-29" }, session.token);
      await refresh();
      return;
    }
    if (message.command === "signOut") {
      try {
        await apiRequest("/auth/logout", "POST", undefined, session.token);
      } catch {
        // Best-effort logout; still clear local state.
      }
      authProvider.notifySessionRemoved(session);
      await clearAuthSession(context);
      applySignedOutAuthStatusBar(statusItem);
      await refresh();
    }
  });

  await refresh();
}

async function ensureSession(
  context: vscode.ExtensionContext,
  statusItem: vscode.StatusBarItem,
  authProvider: SkipprAuthenticationProvider
): Promise<AuthSession | undefined> {
  const existing = await readAuthSession(context);
  if (!existing) {
    applySignedOutAuthStatusBar(statusItem);
    return undefined;
  }

  applySignedInAuthStatusBar(statusItem, existing.email, "Signed in to Skippr (validating…)");

  const sessionResponse = await tryApiRequest("/auth/session", "GET", undefined, existing.token);
  if (sessionResponse === null) {
    applySignedInAuthStatusBar(statusItem, existing.email, "Signed in to Skippr (could not reach auth — retry when online)");
    return existing;
  }
  if (sessionResponse.ok) {
    applySignedInAuthStatusBar(statusItem, existing.email);
    return existing;
  }

  const refreshResponse = await tryApiRequest("/auth/refresh", "POST", { refresh_token: existing.refreshToken });
  if (refreshResponse === null) {
    applySignedInAuthStatusBar(statusItem, existing.email, "Signed in to Skippr (could not reach auth — retry when online)");
    return existing;
  }
  if (!refreshResponse.ok) {
    authProvider.notifySessionRemoved(existing);
    await clearAuthSession(context);
    applySignedOutAuthStatusBar(statusItem);
    return undefined;
  }

  const refreshed = (await refreshResponse.json()) as { token: string; refresh_token: string };
  const next: AuthSession = { token: refreshed.token, refreshToken: refreshed.refresh_token, email: existing.email };
  await saveAuthSession(context, next);
  authProvider.notifySessionUpdated(next);
  applySignedInAuthStatusBar(statusItem, existing.email);
  return next;
}

function renderPanelHtml(payload: SkipprPanelPayload, session?: AuthSession): string {
  const resources = payload.resources
    .map((resource) => `<li><strong>${resource.label}</strong><br /><span>${resource.path}</span></li>`)
    .join("");
  const catalog = payload.catalog.map((entry) => `<li>${entry.name} (${entry.owner})</li>`).join("");
  const diagnostics = payload.diagnostics.map((diagnostic) => `<li>${diagnostic}</li>`).join("");
  const addedColumns = payload.diff.after.filter((column) => !payload.diff.before.includes(column)).join(", ");
  const loginState = session ? `Signed in as ${session.email}` : "Not signed in";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    .root { display: grid; grid-template-columns: 1fr 2fr 1fr; height: 100vh; }
    .pane { padding: 10px; overflow: auto; border-right: 1px solid var(--vscode-panel-border); }
    .pane:last-child { border-right: none; }
    .title { font-weight: 600; margin-bottom: 8px; }
    .section { margin-bottom: 16px; }
    ul { margin: 0; padding-left: 16px; }
    button { cursor: pointer; }
  </style>
</head>
<body>
  <div class="root">
    <section class="pane">
      <div class="title">${payload.panelName} Tree</div>
      <ul>${resources}</ul>
    </section>
    <main class="pane">
      <div class="section">
        <div class="title">${payload.panelName} Detail</div>
        <div>Model diff: ${payload.diff.model}</div>
        <div>Added columns: ${addedColumns || "None"}</div>
      </div>
      <div class="section">
        <div class="title">Skippr Data Agent</div>
        <div>Runbook: Discover -> Sync -> Model</div>
        <div>Login: ${loginState}</div>
      </div>
      <div class="section">
        <div class="title">Connection</div>
        <div>Workspace: ${payload.settings.workspacePath || "Not configured"}</div>
        <div>API target: ${payload.settings.apiTarget || "Mock only"}</div>
      </div>
    </main>
    <aside class="pane">
      <div class="section"><div class="title">Catalog</div><ul>${catalog}</ul></div>
      <div class="section"><div class="title">Agent Debug Logs</div><ul>${diagnostics}</ul></div>
    </aside>
  </div>
</body>
</html>`;
}

async function openPanel(
  context: vscode.ExtensionContext,
  panelId: SkipprPanelId,
  panelName: SkipprPanelName,
  statusItem: vscode.StatusBarItem,
  authProvider: SkipprAuthenticationProvider
): Promise<void> {
  const session = await ensureSession(context, statusItem, authProvider);
  const payload = await loadPanelPayloadFromRust(context.extensionPath, panelId, panelName, loadConnectionSettings());
  const panel = vscode.window.createWebviewPanel(
    `skippr.${panelId}`,
    `Skippr ${panelName}`,
    vscode.ViewColumn.Active,
    { enableScripts: true }
  );
  panel.webview.html = renderPanelHtml(payload, session);
}

type SplashAction =
  | "engineer"
  | "business"
  | "openRecent"
  | "openFolder"
  | "signin"
  | "discover"
  | "continue";

let activeSplashPanel: vscode.WebviewPanel | undefined;

async function runWorkbenchCommand(command: string): Promise<void> {
  try {
    await vscode.commands.executeCommand(command);
  } catch {
    // Some workbench commands are context-sensitive or unavailable in tests.
  }
}

async function hideWorkbenchForSplash(): Promise<void> {
  await runWorkbenchCommand("skippr.workbench.hideForSplash");
}

async function restoreFullIdeLayout(): Promise<void> {
  await runWorkbenchCommand("skippr.workbench.restoreFromSplash");
  await runWorkbenchCommand("workbench.action.activityBarLocation.default");
  await runWorkbenchCommand("workbench.action.restoreAuxiliaryBar");
  await runWorkbenchCommand("workbench.view.explorer");
  await runWorkbenchCommand("workbench.action.closePanel");
  await runWorkbenchCommand("workbench.action.focusActiveEditorGroup");
}

async function enterAgentsOnlyLayout(): Promise<void> {
  await runWorkbenchCommand("workbench.action.activityBarLocation.hide");
  await runWorkbenchCommand("workbench.action.closeSidebar");
  await runWorkbenchCommand("workbench.action.closePanel");
  await runWorkbenchCommand("workbench.action.restoreAuxiliaryBar");
  await runWorkbenchCommand("workbench.action.chat.open");
  await runWorkbenchCommand("workbench.action.toggleMaximizedAuxiliaryBar");
}

function renderSplashHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 32px;
      color: var(--vscode-foreground);
      background:
        radial-gradient(circle at 50% 0%, rgba(84, 108, 255, 0.14), transparent 34rem),
        linear-gradient(180deg, var(--vscode-editor-background), color-mix(in srgb, var(--vscode-editor-background) 88%, #000 12%));
      font-family: var(--vscode-font-family);
    }
    .card {
      width: min(460px, calc(100vw - 48px));
      padding: 30px;
      border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 76%, transparent);
      border-radius: 20px;
      background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-sideBar-background));
      box-shadow: 0 24px 90px rgba(0, 0, 0, 0.36);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 22px;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
      letter-spacing: 0.02em;
    }
    .mark {
      width: 24px;
      height: 24px;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--vscode-button-background), color-mix(in srgb, var(--vscode-button-background) 58%, #fff 42%));
      box-shadow: 0 10px 30px color-mix(in srgb, var(--vscode-button-background) 35%, transparent);
    }
    h1 {
      margin: 0 0 20px;
      font-size: 28px;
      line-height: 1.12;
      font-weight: 650;
      letter-spacing: -0.02em;
    }
    .choices {
      display: grid;
      gap: 12px;
      margin-bottom: 22px;
    }
    button {
      width: 100%;
      border: 1px solid transparent;
      border-radius: 14px;
      padding: 14px 16px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-input-background) 72%, transparent);
      border-color: var(--vscode-panel-border);
    }
    button.ghost {
      padding: 6px 0;
      width: auto;
      color: var(--vscode-textLink-foreground);
      background: transparent;
      border: 0;
      border-radius: 0;
      text-align: center;
    }
    .label {
      display: block;
      font-size: 15px;
      font-weight: 650;
      margin-bottom: 4px;
    }
    .copy {
      display: block;
      color: color-mix(in srgb, currentColor 72%, transparent);
      font-size: 12px;
      line-height: 1.45;
    }
    .divider {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 12px;
      margin: 20px 0;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
    .divider::before, .divider::after {
      content: "";
      height: 1px;
      background: var(--vscode-panel-border);
    }
    .project-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .links {
      display: flex;
      justify-content: center;
      gap: 16px;
      margin-top: 20px;
      font-size: 12px;
    }
    @media (max-width: 520px) {
      body { padding: 20px; }
      .card { width: 100%; padding: 22px; }
      .project-actions { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="card" aria-labelledby="splash-title">
    <div class="brand"><span class="mark" aria-hidden="true"></span><span>Skippr IDE</span></div>
    <h1 id="splash-title">Who are you?</h1>

    <section class="choices" aria-label="Choose your experience">
      <button data-action="engineer">
        <span class="label">Engineer</span>
        <span class="copy">Give me the full IDE.</span>
      </button>
      <button data-action="business" class="secondary">
        <span class="label">Business User</span>
        <span class="copy">IDEhhh? Show my data insights.</span>
      </button>
    </section>

    <div class="divider"><span>Open existing project</span></div>

    <section class="project-actions" aria-label="Open an existing project">
      <button data-action="openRecent" class="secondary">
        <span class="label">Open Recent</span>
      </button>
      <button data-action="openFolder" class="secondary">
        <span class="label">Browse...</span>
      </button>
    </section>

    <nav class="links" aria-label="Skippr account">
      <button data-action="signin" class="ghost">Sign in</button>
      <button data-action="discover" class="ghost">Discover</button>
      <button data-action="continue" class="ghost">Continue</button>
    </nav>
  </main>
  <script>
    const vscode = acquireVsCodeApi();
    document.addEventListener("click", event => {
      const button = event.target.closest("button[data-action]");
      if (button) {
        vscode.postMessage({ command: button.dataset.action });
      }
    });
  </script>
</body>
</html>`;
}

function isEmptyWorkbench(): boolean {
  return (vscode.workspace.workspaceFolders?.length ?? 0) === 0;
}

async function showSplash(
  context: vscode.ExtensionContext,
  statusItem: vscode.StatusBarItem,
  authProvider: SkipprAuthenticationProvider,
  options: { auto?: boolean } = {}
): Promise<void> {
  if (activeSplashPanel) {
    activeSplashPanel.reveal(vscode.ViewColumn.Active);
    return;
  }

  await hideWorkbenchForSplash();
  const panel = vscode.window.createWebviewPanel("skippr.splash", "Skippr IDE", vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true
  });
  activeSplashPanel = panel;
  let restoreOnDispose = true;

  const markDismissed = async () => {
    if (options.auto) {
      await context.workspaceState.update(splashDismissedKey, true);
    }
  };
  const closeSplash = async (restoreWorkbench: boolean) => {
    restoreOnDispose = restoreWorkbench;
    await markDismissed();
    activeSplashPanel = undefined;
    panel.dispose();
  };

  panel.webview.html = renderSplashHtml();
  setTimeout(() => {
    if (activeSplashPanel === panel) {
      void hideWorkbenchForSplash();
    }
  }, 150);
  panel.onDidDispose(() => {
    if (activeSplashPanel === panel) {
      activeSplashPanel = undefined;
    }
    void markDismissed();
    if (restoreOnDispose) {
      void restoreFullIdeLayout();
    }
  });

  panel.webview.onDidReceiveMessage(async (message: { command?: SplashAction }) => {
    switch (message.command) {
      case "engineer":
      case "continue":
        await restoreFullIdeLayout();
        await closeSplash(false);
        return;
      case "business":
        await enterAgentsOnlyLayout();
        await closeSplash(false);
        return;
      case "openRecent":
        await runWorkbenchCommand("workbench.action.openRecent");
        return;
      case "openFolder":
        await runWorkbenchCommand("workbench.action.files.openFileFolder");
        return;
      case "signin": {
        const session = await signIn(context, statusItem, authProvider, false);
        if (session) {
          vscode.window.showInformationMessage(`Signed in to Skippr as ${session.email}.`);
        }
        return;
      }
      case "discover":
        await restoreFullIdeLayout();
        await closeSplash(false);
        await vscode.commands.executeCommand("skippr.open.discover");
        return;
    }
  });
}

function maybeOpenEmptyWorkbenchSplash(
  context: vscode.ExtensionContext,
  statusItem: vscode.StatusBarItem,
  authProvider: SkipprAuthenticationProvider
): void {
  if (!isEmptyWorkbench() || context.workspaceState.get<boolean>(splashDismissedKey)) {
    return;
  }
  setTimeout(() => {
    if (isEmptyWorkbench()) {
      void showSplash(context, statusItem, authProvider, { auto: true });
    }
  }, 0);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  observabilityStore = new SkipprRunStateStore();
  context.subscriptions.push(observabilityStore);
  registerSkipprRunStatusView(context);
  registerSkipprRunDetailsView(context, SKIPPR_RUN_TIMELINE_VIEW_ID, "timeline");
  registerSkipprRunDetailsView(context, SKIPPR_RUN_SCHEMA_CHANGES_VIEW_ID, "schema");
  registerSkipprRunDetailsView(context, SKIPPR_RUN_DEADLETTERS_VIEW_ID, "deadletters");
  registerSkipprSchemaView(context);
  registerSkipprLineageLaunchView(context);
  registerSkipprQueryResultsView(context);
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
  const authProvider = new SkipprAuthenticationProvider(context, statusItem);
  await syncAuthStatusBarFromStoredSecrets(context, statusItem);
  statusItem.show();
  context.subscriptions.push(statusItem);

  const runStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 999);
  setRunStatusIdle(runStatusItem);
  runStatusItem.show();

  const output = vscode.window.createOutputChannel("Skippr", { log: true });
  context.subscriptions.push(runStatusItem, output);
  context.subscriptions.push(
    vscode.commands.registerCommand("skippr.internal.runModelForAgentChat", async (request: AgentModelRunRequest, bridgeDir?: string) => {
      const workspaceRoot = request?.workspaceRoot?.trim() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const resolvedBridgeDir = bridgeDir?.trim() || (workspaceRoot ? agentBridgeDirForWorkspace(workspaceRoot) : undefined);
      if (!resolvedBridgeDir) {
        return;
      }
      await runAgentModelBridgeRequest(request, resolvedBridgeDir, output, runStatusItem);
    })
  );
  registerAgentModelBridge(context, output, runStatusItem);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    runHistory = new SkipprRunHistory(workspaceRoot, output);
    void refreshRunHistory();
  }
  observabilityStore.onDidChange(() => schedulePostObservability(), undefined, context.subscriptions);
  void runWorkbenchCommand("skippr.workbench.forceRunPanels");
  void runWorkbenchCommand("skippr.workbench.forceSchemaSidebar");
  await vscode.commands.executeCommand("setContext", SKIPPR_RUN_TOOLBAR_CONTEXT_KEY, true);
  await vscode.commands.executeCommand("setContext", "skippr.editorDbtRunMode", dbtEditorRunMode);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => scheduleDbtEditorContextRefresh(output)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === "sql") {
        scheduleDbtEditorContextRefresh(output);
      }
    })
  );
  scheduleDbtEditorContextRefresh(output);
  context.subscriptions.push(
    vscode.authentication.registerAuthenticationProvider("skippr", "Skippr", authProvider, {
      supportsMultipleAccounts: false
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("skippr._runToolbarModel", async (args?: unknown) => {
      const a = args as { command?: string; pipeline?: string } | undefined;
      const command = typeof a?.command === "string" ? a.command : "discover";
      const pipelineArg = typeof a?.pipeline === "string" ? a.pipeline.trim() : "";
      const configPath = await resolveSkipprConfigAtCwd();
      const folderUri = configPath.trim() ? workspaceFolderForConfigPath(configPath) : undefined;
      const ws = vscode.workspace.getConfiguration(undefined, folderUri);
      let defaultPipeline = ws.get<string>(defaultPipelineKey, "").trim();
      const show = configPath.trim() ? await getToolbarConfigShow(output, configPath) : undefined;
      const pipelines = show?.pipelines ?? [];
      if (!defaultPipeline && show) {
        defaultPipeline = (show.default_pipeline ?? pipelines[0] ?? "").trim();
      }
      let tests: Array<{ value: string; label: string }> | undefined;
      if (command === "test" && pipelineArg) {
        tests = await fetchTestSelectOptionsForRunDebug(output, configPath, pipelineArg);
      }
      return { configPath, defaultPipeline, pipelines, tests };
    }),
    vscode.commands.registerCommand("skippr._runToolbarExecute", async (args?: unknown) => {
      const m = args as Record<string, unknown> | undefined;
      const command = typeof m?.command === "string" ? m.command : "";
      const rawSync = m?.syncMode;
      const syncMode =
        rawSync === "stream" || rawSync === "once" ? (rawSync as "once" | "stream") : undefined;
      const extraArgs =
        m && Object.prototype.hasOwnProperty.call(m, "extraArgs") && typeof m.extraArgs === "string"
          ? (m.extraArgs as string)
          : vscode.workspace.getConfiguration().get<string>(runExtraArgsKey, "").trim();
      await executeRunDebugPanelRun(
        {
          command,
          configPath: typeof m?.configPath === "string" ? m.configPath : undefined,
          pipeline: typeof m?.pipeline === "string" ? m.pipeline : undefined,
          testSelect: typeof m?.testSelect === "string" ? m.testSelect : undefined,
          extraArgs,
          syncMode,
          modelNoResume: m?.modelNoResume === true
        },
        output,
        runStatusItem
      );
    })
  );
  registerSkipprConfigDiagnostics(context, {
    resolveCliPath: () => resolveSkipprCli(vscode.workspace.getConfiguration().get<string>(cliPathKey, "")),
    output
  });
  registerSkipprPipelineTestControllers(context, {
    output,
    resolveCliPath: () => resolveSkipprCli(vscode.workspace.getConfiguration().get<string>(cliPathKey, "")),
    getConfigCwd: (configFsPath: string) => getConfigCwd(configFsPath),
    revealSkipprOutput: () => output.show(false),
    getLogLevel: () => getLogLevel(),
    getRunExtraArgsText: () => vscode.workspace.getConfiguration().get<string>(runExtraArgsKey, "").trim()
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("skippr.configureConnection", async () => {
      await configureConnection();
    }),
    vscode.commands.registerCommand("skippr.auth.signIn", async () => {
      await signIn(context, statusItem, authProvider);
    }),
    vscode.commands.registerCommand("skippr.auth.account", async () => {
      await showAccount(context, statusItem, authProvider);
    }),
    vscode.commands.registerCommand("skippr.auth.signOut", async () => {
      const session = await readAuthSession(context);
      if (session) {
        try {
          await apiRequest("/auth/logout", "POST", undefined, session.token);
        } catch {
          // ignore
        }
        authProvider.notifySessionRemoved(session);
      }
      await clearAuthSession(context);
      applySignedOutAuthStatusBar(statusItem);
      vscode.window.showInformationMessage("Signed out from Skippr.");
    }),
    vscode.commands.registerCommand("skippr.auth.refresh", async () => {
      const existing = await readAuthSession(context);
      if (!existing) {
        return;
      }
      const refreshResponse = await tryApiRequest("/auth/refresh", "POST", { refresh_token: existing.refreshToken });
      if (refreshResponse === null) {
        vscode.window.showWarningMessage("Skippr: could not reach auth to refresh token.");
        return;
      }
      if (!refreshResponse.ok) {
        authProvider.notifySessionRemoved(existing);
        await clearAuthSession(context);
        applySignedOutAuthStatusBar(statusItem);
        vscode.window.showWarningMessage("Skippr: refresh failed. Sign in again.");
        return;
      }
      const refreshed = (await refreshResponse.json()) as { token: string; refresh_token: string };
      const next: AuthSession = {
        token: refreshed.token,
        refreshToken: refreshed.refresh_token,
        email: existing.email
      };
      await saveAuthSession(context, next);
      authProvider.notifySessionUpdated(next);
      applySignedInAuthStatusBar(statusItem, existing.email);
    }),
    vscode.commands.registerCommand("skippr.openSplash", async () => {
      await showSplash(context, statusItem, authProvider);
    }),
    vscode.commands.registerCommand("skippr.cli.install", async () => {
      const result = await installSkipprCli(output);
      if (result.code === 0) {
        vscode.window.showInformationMessage("Skippr CLI installed.");
      } else {
        vscode.window.showErrorMessage("Skippr CLI install failed. See Skippr output for details.");
      }
    }),
    vscode.commands.registerCommand("skippr.cli.update", async () => {
      const cliPath = await resolveSkipprCli(vscode.workspace.getConfiguration().get<string>(cliPathKey, ""));
      const result = await updateSkipprCli(cliPath, output, skipprSpawnEnv(undefined, undefined));
      if (result.code === 0) {
        vscode.window.showInformationMessage("Skippr CLI updated.");
      } else {
        vscode.window.showErrorMessage("Skippr CLI update failed. See Skippr output for details.");
      }
    }),
    vscode.commands.registerCommand("skippr.cli.showVersion", async () => {
      const cliPath = await resolveCliOrOfferInstall(output);
      if (!cliPath) {
        return;
      }
      const result = await showSkipprVersion(cliPath, output, skipprSpawnEnv(undefined, undefined));
      if (result.code !== 0) {
        vscode.window.showErrorMessage("Unable to read Skippr CLI version. See Skippr output for details.");
      }
    }),
    vscode.commands.registerCommand("skippr.setupWorkspace", async () => {
      await showSetupWebview(output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.validateConfiguration", async () => {
      await refreshConfigStatus(output, runStatusItem);
      if (activeConfigStatus?.ok) {
        vscode.window.showInformationMessage("Skippr configuration is ready.");
      } else {
        vscode.window.showWarningMessage("Skippr configuration needs attention. See Skippr output or setup.");
      }
    }),
    vscode.commands.registerCommand("skippr.openConfig", async () => {
      await openActiveConfig(output);
    }),
    vscode.commands.registerCommand("skippr.sql.newQuery", async () => {
      await newSqlQueryDocument();
    }),
    vscode.commands.registerCommand("skippr.sql.runSelection", async () => {
      await runSqlTextFromEditor(true, output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.sql.runDocument", async () => {
      await runSqlTextFromEditor(false, output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.sql.runDbtDocument", async () => {
      await runSqlTextFromEditor(false, output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.sql.pickRunMode", async () => {
      const picked = await vscode.window.showQuickPick(
        [
          { label: "SQL", description: "Compile model and run warehouse SQL", mode: "sql" as const },
          { label: "Tests", description: "Run dbt tests for this model", mode: "tests" as const }
        ],
        {
          title: "Run SQL|DBT",
          placeHolder: `Current: ${dbtRunModeMenuTitle(dbtEditorRunMode)}`
        }
      );
      if (!picked) {
        return;
      }
      dbtEditorRunMode = picked.mode;
      await vscode.commands.executeCommand("setContext", "skippr.editorDbtRunMode", dbtEditorRunMode);
    }),
    vscode.commands.registerCommand("skippr.sql.setRunModeSql", async () => {
      dbtEditorRunMode = "sql";
      await vscode.commands.executeCommand("setContext", "skippr.editorDbtRunMode", dbtEditorRunMode);
    }),
    vscode.commands.registerCommand("skippr.sql.setRunModeTests", async () => {
      dbtEditorRunMode = "tests";
      await vscode.commands.executeCommand("setContext", "skippr.editorDbtRunMode", dbtEditorRunMode);
    }),
    vscode.commands.registerCommand("skippr.sql.askDataQuestion", async () => {
      await askDataQuestion(output);
    }),
    vscode.commands.registerCommand("skippr.editPipelineEnv", async () => {
      const configPath = activeConfigPath ?? (await chooseActiveConfig(output));
      if (!configPath) {
        vscode.window.showWarningMessage("No skippr.yml or skippr.yaml in the workspace.");
        return;
      }
      const folderUri = workspaceFolderForConfigPath(configPath);
      const conf = vscode.workspace.getConfiguration("skippr", folderUri);
      const show = await getConfigShow(output);
      const fallback = conf.get<string>(defaultPipelineKey, "").trim();
      const names = show?.pipelines?.length ? show.pipelines : fallback ? [fallback] : [];
      if (!names.length) {
        vscode.window.showWarningMessage("No pipelines found. Set skippr.defaultPipeline or fix the config.");
        return;
      }
      const pipeline = await vscode.window.showQuickPick(names, { title: "Pipeline for per-pipeline env vars" });
      if (!pipeline) {
        return;
      }
      const key = await vscode.window.showInputBox({
        prompt: "Environment variable name (e.g. SNOWFLAKE_ACCOUNT)",
        validateInput: (v) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.trim()) ? undefined : "Use letters, numbers, underscore; start with a letter or _.")
      });
      if (!key?.trim()) {
        return;
      }
      const val = await vscode.window.showInputBox({ prompt: `Value for ${key.trim()}` });
      if (val === undefined) {
        return;
      }
      const cur = conf.get<Record<string, Record<string, string>>>("pipelineEnv", {});
      const next: Record<string, Record<string, string>> = { ...cur };
      next[pipeline] = { ...(next[pipeline] ?? {}), [key.trim()]: val };
      await conf.update(
        "pipelineEnv",
        next,
        folderUri ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace
      );
      vscode.window.showInformationMessage(`Updated skippr.pipelineEnv for pipeline "${pipeline}".`);
    }),
    vscode.commands.registerCommand("skippr.run.discoverPipeline", async () => {
      await runSkipprCommand("discover", output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.run.syncPipelineOnce", async () => {
      await runSkipprCommand("sync-once", output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.run.syncAllOnce", async () => {
      await runSkipprCommand("sync-all-once", output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.run.startSyncPipeline", async () => {
      await runSkipprCommand("sync", output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.run.modelPipeline", async () => {
      await openModelWorkflowInAgentChat(output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.run.doctor", async () => {
      await runSkipprDoctor(output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.run.pickPipelineAction", async (configFsPath: unknown, pipeline: unknown, line: unknown) => {
      await runPickPipelineAction(configFsPath, pipeline, line, output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.run.lens.discover", () => runLensPipelineCommand("discover", context, output, runStatusItem)),
    vscode.commands.registerCommand("skippr.run.lens.sync", () => runLensPipelineCommand("sync", context, output, runStatusItem)),
    vscode.commands.registerCommand("skippr.run.lens.model", () => runLensPipelineCommand("model", context, output, runStatusItem)),
    vscode.commands.registerCommand("skippr.run.lens.doctor", () => runLensPipelineCommand("doctor", context, output, runStatusItem)),
    vscode.commands.registerCommand("skippr.run.lens.lineage", () => runLensPipelineCommand("lineage", context, output, runStatusItem)),
    vscode.commands.registerCommand("skippr.run.lensWithArgs", (configFsPath: unknown, pipeline: unknown, command: unknown) =>
      runLensPipelineWithArgs(configFsPath, pipeline, command, context, output, runStatusItem)
    ),
    vscode.languages.registerCodeLensProvider(
      skipprConfigDocumentSelector,
      new SkipprPipelineCodeLensProvider("skippr.run.lensWithArgs", "skippr.run.pickPipelineAction")
    ),
    vscode.commands.registerCommand("skippr.run.stopSyncPipeline", () => {
      stopActiveRun(runStatusItem, output);
    }),
    vscode.debug.registerDebugAdapterDescriptorFactory("skippr", {
      createDebugAdapterDescriptor: () =>
        new vscode.DebugAdapterInlineImplementation(
          new SkipprDebugAdapter((configuration) => runSkipprDebugConfiguration(configuration, output, runStatusItem))
        )
    }),
    vscode.debug.registerDebugConfigurationProvider("skippr", {
      provideDebugConfigurations: () => [],
      resolveDebugConfiguration: (folder, configuration) => {
        if (!configuration.type) {
          return {
            type: "skippr",
            request: "launch",
            name: "Skippr: Discover",
            skipprKind: "discover",
            configPath: "${workspaceFolder}/skippr.yml",
            logLevel: "info",
            pipeline: "${config:skippr.defaultPipeline}"
          };
        }
        if (configuration.type !== "skippr") {
          return configuration;
        }
        const next: vscode.DebugConfiguration = { ...configuration };
        if (next.skipprKind === "sync") {
          next.skipprKind = "sync-once";
        }
        const kind = next.skipprKind;
        if (
          (isSkipprRunKind(kind) || kind === "test") &&
          kind !== "sync-all-once" &&
          kind !== "doctor" &&
          !String(next.pipeline ?? "").trim()
        ) {
          const def = vscode.workspace.getConfiguration("skippr", folder?.uri).get<string>("defaultPipeline", "")?.trim();
          if (def) {
            next.pipeline = def;
          }
        }
        return next;
      }
    })
  );

  for (const panel of panelSpecs) {
    context.subscriptions.push(
      vscode.commands.registerCommand(panel.command, async (args?: unknown) => {
        if (panel.id === "skippr.model") {
          await openModelWorkflowInAgentChat(output, runStatusItem);
          return;
        }
        if (panel.id === "skippr.lineage") {
          const lineageArgs = args as { configPath?: unknown; pipeline?: unknown } | undefined;
          await openLineagePanel(context, output, {
            configPath: typeof lineageArgs?.configPath === "string" ? lineageArgs.configPath : undefined,
            pipeline: typeof lineageArgs?.pipeline === "string" ? lineageArgs.pipeline : undefined
          });
          return;
        }
        await openPanel(context, panel.id, panel.name, statusItem, authProvider);
      })
    );
  }

  void ensureSession(context, statusItem, authProvider);
  const configWatcher = vscode.workspace.createFileSystemWatcher("**/skippr.{yml,yaml}");
  context.subscriptions.push(
    configWatcher,
    configWatcher.onDidCreate(() => {
      invalidateToolbarConfigShowCache();
      void chooseActiveConfig(output).then(() => refreshConfigStatus(output, runStatusItem));
    }),
    configWatcher.onDidChange(() => {
      invalidateToolbarConfigShowCache();
      void refreshConfigStatus(output, runStatusItem);
    }),
    configWatcher.onDidDelete(() => {
      invalidateToolbarConfigShowCache();
      activeConfigPath = undefined;
      void chooseActiveConfig(output).then(() => refreshConfigStatus(output, runStatusItem));
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      invalidateToolbarConfigShowCache();
      activeConfigPath = undefined;
      void chooseActiveConfig(output).then(() => refreshConfigStatus(output, runStatusItem));
    })
  );
  void chooseActiveConfig(output).then(async () => {
    await refreshConfigStatus(output, runStatusItem);
    await runVectorIngestOnOpen(context, output, runStatusItem);
  });
  maybeOpenEmptyWorkbenchSplash(context, statusItem, authProvider);
}

export function deactivate(): void {}
