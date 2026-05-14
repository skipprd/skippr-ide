import * as vscode from "vscode";
import * as path from "node:path";
import { isSkipprChatModeId, skipprChatModeFor, SkipprChatModeId } from "./chatModes";
import { loadPanelPayloadFromRust } from "./rustBridge";
import {
  installSkipprCli,
  isSkipprRunKind,
  resolveSkipprCli,
  runSkipprJson,
  showSkipprVersion,
  SkipprProcess,
  SkipprRunKind,
  startSkipprRun,
  updateSkipprCli
} from "./skipprRunner";
import { registerSkipprPipelineTestController } from "./skipprPipelineTestController";
import {
  ConnectionSettings,
  SkipprConfigShowResult,
  SkipprDoctorResult,
  SkipprPanelId,
  SkipprPanelName,
  SkipprPanelPayload,
  SkipprRunEvent
} from "./types";

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
const splashSeenKey = "skippr.splashSeen.v1";
const cliPathKey = "skippr.cliPath";
const defaultPipelineKey = "skippr.defaultPipeline";
const logLevelKey = "skippr.logLevel";
const runCwdKey = "skippr.run.cwd";

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

interface SkipprChatCommandResult {
  ok: boolean;
  answer?: string;
  plan?: string;
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

  async createSession(): Promise<vscode.AuthenticationSession> {
    const session = await signIn(this.context, this.statusItem);
    if (!session) {
      throw new Error("Skippr sign-in was cancelled.");
    }
    this.emitter.fire({ added: [this.toVsCodeSession(session)], removed: [], changed: [] });
    return this.toVsCodeSession(session);
  }

  async removeSession(): Promise<void> {
    const session = await readAuthSession(this.context);
    await clearAuthSession(this.context);
    this.statusItem.text = "$(sign-in) Skippr Sign In";
    this.statusItem.tooltip = "Sign in to Skippr";
    this.statusItem.command = "skippr.auth.account";
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
  const config = vscode.workspace.getConfiguration();
  const configured = config.get<string>(runCwdKey, "").trim();
  if (configured) {
    return configured;
  }
  const workspacePath = config.get<string>(workspacePathKey, "").trim();
  if (workspacePath) {
    return workspacePath;
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

function getLogLevel(): string {
  return vscode.workspace.getConfiguration().get<string>(logLevelKey, "info").trim() || "info";
}

function getConfigCwd(configPath?: string): string {
  return configPath ? path.dirname(configPath) : getRunCwd();
}

async function detectSkipprConfigs(): Promise<string[]> {
  const found: string[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const name of ["skippr.yml", "skippr.yaml"]) {
      const uri = vscode.Uri.joinPath(folder.uri, name);
      try {
        await vscode.workspace.fs.stat(uri);
        found.push(uri.fsPath);
      } catch {
        // Missing config files are expected in non-Skippr workspaces.
      }
    }
  }
  return found;
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

  const configResult = await runSkipprJson<SkipprConfigShowResult>(cliPath, ["--config", configPath, "config", "show"], getConfigCwd(configPath), output);
  if (!configResult.value?.ok) {
    activeConfigStatus = undefined;
    statusItem.command = "skippr.setupWorkspace";
    statusItem.text = "$(warning) Skippr: config invalid";
    statusItem.tooltip = `Unable to parse ${configPath}`;
    return;
  }

  const hasPipelines = configResult.value.pipelines.length > 0;
  const hasConnections = configResult.value.sources.length > 0 && configResult.value.sinks.length > 0;
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
  const cliPath = await resolveCliOrOfferInstall(output);
  if (!cliPath) {
    return undefined;
  }
  const result = await runSkipprJson<SkipprConfigShowResult>(cliPath, ["--config", configPath, "config", "show"], getConfigCwd(configPath), output);
  return result.value;
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
    <label for="logLevel">Log level</label>
    <select id="logLevel">
      ${["debug", "info", "warn", "error"].map((level) => `<option value="${level}" ${level === logLevel ? "selected" : ""}>${level}</option>`).join("")}
    </select>
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
      logLevel: document.getElementById("logLevel").value
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

function describeRunEvent(event: SkipprRunEvent): string {
  switch (event.event) {
    case "discover_start":
      return `Discover started: ${event.pipeline ?? "pipeline"}`;
    case "namespace_discovered":
      return `Discovered ${event.namespace ?? "namespace"} (${event.field_count ?? 0} fields)`;
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
    case "model_start":
      return `Model started: ${event.pipeline ?? "pipeline"}`;
    case "model_thread_resumed":
      return `Model resumed thread ${event.thread_id ?? "unknown"}`;
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
}

function setRunStatusIdle(statusItem: vscode.StatusBarItem): void {
  statusItem.command = "skippr.run.discoverPipeline";
  statusItem.text = "$(play) Skippr";
  statusItem.tooltip = "Run Skippr discover or sync commands";
}

function setRunStatusRunning(statusItem: vscode.StatusBarItem, label: string): void {
  statusItem.command = "skippr.run.stopSyncPipeline";
  statusItem.text = `$(sync~spin) ${label}`;
  statusItem.tooltip = "Skippr is running. Click to stop.";
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

async function runSkipprCommand(
  kind: SkipprRunKind,
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem,
  requestedPipeline?: string,
  requestedConfigPath?: string,
  requestedLogLevel?: string
): Promise<void> {
  if (activeRun) {
    if (kind === "model") {
      output.show(true);
      output.info(`Attached to active ${activeRun.label}. Stop/cancel is the only in-flight control surface.`);
      vscode.window.showInformationMessage(`Attached to active ${activeRun.label}.`);
      return;
    }
    vscode.window.showWarningMessage(`Skippr is already running: ${activeRun.label}`);
    output.show(true);
    return;
  }

  const request = requestedPipeline || requestedConfigPath || requestedLogLevel ? undefined : await showRunConfigModal(kind, output);
  if (!request && !requestedPipeline && !requestedConfigPath && !requestedLogLevel) {
    return;
  }
  const pipeline = kind === "sync-all-once" ? undefined : requestedPipeline?.trim() || request?.pipeline?.trim();
  if (kind !== "sync-all-once" && !pipeline) {
    return;
  }

  const configPath = requestedConfigPath?.trim() || request?.configPath?.trim() || activeConfigPath || (await chooseActiveConfig(output));
  if (!configPath) {
    vscode.window.showWarningMessage("No Skippr config found. Use Skippr: Setup Workspace first.");
    await showSetupWebview(output, statusItem);
    return;
  }

  const cliPath = await resolveCliOrOfferInstall(output);
  if (!cliPath) {
    return;
  }

  output.show(true);
  const run = startSkipprRun(
    {
      kind,
      cliPath,
      cwd: getConfigCwd(configPath),
      configPath,
      pipeline,
      logLevel: requestedLogLevel?.trim() || request?.logLevel?.trim() || getLogLevel()
    },
    {
      onEvent: (event) => {
        const message = describeRunEvent(event);
        output.info(message);
        setRunStatusRunning(statusItem, message);
      },
      onLog: (line) => output.info(line)
    }
  );

  activeRun = run;
  setRunStatusRunning(statusItem, run.label);
  const result = await run.done;
  if (activeRun === run) {
    activeRun = undefined;
  }

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
}

async function resolveChatRunTarget(output: vscode.LogOutputChannel): Promise<{ pipeline: string; configPath: string } | undefined> {
  const configPath = activeConfigPath || (await chooseActiveConfig(output));
  if (!configPath) {
    return undefined;
  }
  const config = vscode.workspace.getConfiguration();
  const configuredPipeline = config.get<string>(defaultPipelineKey, "").trim();
  if (configuredPipeline) {
    return { pipeline: configuredPipeline, configPath };
  }
  const configShow = await getConfigShow(output);
  const pipeline = configShow?.default_pipeline ?? configShow?.pipelines[0];
  return pipeline ? { pipeline, configPath } : undefined;
}

async function runSkipprChatCli(
  modeId: "ask" | "plan",
  prompt: string,
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem
): Promise<string> {
  const mode = skipprChatModeFor(modeId);
  const target = await resolveChatRunTarget(output);
  if (!target) {
    throw new Error("No Skippr config or pipeline found. Run Skippr: Setup Workspace, then set a default pipeline.");
  }
  const cliPath = await resolveCliOrOfferInstall(output);
  if (!cliPath) {
    throw new Error("Skippr CLI was not found.");
  }
  const args = ["--config", target.configPath, mode.cliCommand!, "--pipeline", target.pipeline, "--output", "json"];
  if (modeId === "ask") {
    args.push("--question", prompt.trim());
  } else if (prompt.trim()) {
    args.push("--goal", prompt.trim());
  }

  output.show(true);
  setRunStatusRunning(statusItem, `${mode.label} ${target.pipeline}`);
  const result = await runSkipprJson<SkipprChatCommandResult>(cliPath, args, getConfigCwd(target.configPath), output);
  setRunStatusIdle(statusItem);
  if (result.code !== 0 || !result.value?.ok) {
    throw new Error(`Skippr ${mode.label} failed. See Skippr output for details.`);
  }
  return result.value.answer ?? result.value.plan ?? `${mode.label} completed.`;
}

function registerSkipprChatParticipant(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem
): void {
  const participant = vscode.chat.createChatParticipant("skippr.chat", async (request, _chatContext, response) => {
    const command = request.command ?? "ask";
    if (command === "model") {
      response.markdown("Starting or attaching to the shared Skippr model run. Live logs are available in Run/Debug and the Skippr output channel.");
      const target = await resolveChatRunTarget(output);
      await runSkipprCommand("model", output, statusItem, target?.pipeline, target?.configPath);
      response.markdown("Model run is now visible under Run/Debug. Stop/cancel is the only in-flight control.");
      return { metadata: { command, mode: "agent" } };
    }
    if (command !== "ask" && command !== "plan") {
      response.markdown("Use `/ask`, `/plan`, or `/model` with `@skippr`.");
      return { metadata: { command } };
    }

    const text = await runSkipprChatCli(command, request.prompt, output, statusItem);
    response.markdown(text);
    return { metadata: { command, mode: command } };
  });
  participant.iconPath = new vscode.ThemeIcon("sparkle");
  participant.followupProvider = {
    provideFollowups: () => [
      { prompt: "@skippr /ask What data is available in this pipeline?", label: "Ask about this pipeline" },
      { prompt: "@skippr /plan Model this pipeline", label: "Plan pipeline modeling" },
      { prompt: "@skippr /model Model this pipeline", label: "Run model" }
    ]
  };
  context.subscriptions.push(participant);
}

async function runSkipprChatMode(
  modeId: SkipprChatModeId,
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem
): Promise<void> {
  const mode = skipprChatModeFor(modeId);
  if (mode.canRunModel) {
    await runSkipprCommand("model", output, statusItem);
    return;
  }

  if (!mode.cliCommand) {
    vscode.window.showWarningMessage(`Skippr ${mode.label} is not wired to a CLI command.`);
    return;
  }

  const request = await showRunConfigModal(mode.cliCommand, output);
  if (!request?.pipeline) {
    return;
  }
  const configPath = request.configPath?.trim() || activeConfigPath || (await chooseActiveConfig(output));
  if (!configPath) {
    vscode.window.showWarningMessage("No Skippr config found. Use Skippr: Setup Workspace first.");
    return;
  }
  const cliPath = await resolveCliOrOfferInstall(output);
  if (!cliPath) {
    return;
  }

  const prompt =
    mode.id === "ask"
      ? await vscode.window.showInputBox({ prompt: "Ask Skippr a read-only question about this pipeline." })
      : await vscode.window.showInputBox({ prompt: "Describe the data-engineering goal to plan.", placeHolder: "Optional" });
  if (mode.id === "ask" && !prompt?.trim()) {
    return;
  }

  const args = ["--config", configPath, mode.cliCommand, "--pipeline", request.pipeline, "--output", "json"];
  if (mode.id === "ask") {
    args.push("--question", prompt?.trim() ?? "");
  } else if (prompt?.trim()) {
    args.push("--goal", prompt.trim());
  }

  output.show(true);
  setRunStatusRunning(statusItem, `${mode.label} ${request.pipeline}`);
  const result = await runSkipprJson<SkipprChatCommandResult>(cliPath, args, getConfigCwd(configPath), output);
  setRunStatusIdle(statusItem);
  if (result.code !== 0 || !result.value?.ok) {
    vscode.window.showErrorMessage(`Skippr ${mode.label} failed. See Skippr output for details.`);
    return;
  }
  const text = result.value.answer ?? result.value.plan ?? `${mode.label} completed.`;
  output.info(text);
  vscode.window.showInformationMessage(`Skippr ${mode.label} completed.`);
}

async function runPickPipelineAction(
  configFsPath: unknown,
  pipeline: unknown,
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem
): Promise<boolean> {
  if (typeof configFsPath !== "string" || typeof pipeline !== "string" || !pipeline.trim()) {
    vscode.window.showErrorMessage("Skippr: missing pipeline or config path.");
    return false;
  }
  const picked = await vscode.window.showQuickPick(
    [
      { label: "$(search) Discover", description: "Discover namespaces for this pipeline", skipprRun: "discover" as const },
      { label: "$(sync) Sync (once)", description: "Run one sync pass", skipprRun: "sync-once" as const },
      { label: "$(circuit-board) Model", description: "Run Skippr model for this pipeline", skipprRun: "model" as const }
    ],
    { title: `Skippr — ${pipeline}`, placeHolder: "Choose run action" }
  );
  if (!picked) {
    return false;
  }
  await runSkipprCommand(picked.skipprRun, output, statusItem, pipeline.trim(), configFsPath.trim());
  return true;
}

async function runSkipprDebugConfiguration(
  configuration: vscode.DebugConfiguration,
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem
): Promise<void> {
  if (!isSkipprRunKind(configuration.skipprKind)) {
    output.error(`Invalid Skippr debug configuration kind: ${String(configuration.skipprKind)}`);
    vscode.window.showErrorMessage("Invalid Skippr debug configuration. Expected skipprKind discover, sync-once, or model.");
    return;
  }
  const kind = configuration.skipprKind;
  if (kind !== "sync-all-once" && !String(configuration.pipeline ?? "").trim()) {
    vscode.window.showErrorMessage("Skippr debug configuration needs a pipeline (set skippr.defaultPipeline or add pipeline to launch.json).");
    return;
  }
  const pipeline = typeof configuration.pipeline === "string" ? configuration.pipeline : undefined;
  const configPath = typeof configuration.configPath === "string" ? configuration.configPath : undefined;
  const logLevel = typeof configuration.logLevel === "string" ? configuration.logLevel : undefined;
  await runSkipprCommand(configuration.skipprKind, output, statusItem, pipeline, configPath, logLevel);
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
  const configPath = activeConfigPath ?? (await chooseActiveConfig(output));
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
  setRunStatusRunning(statusItem, `Initializing ${name.trim()}`);
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
        output
      )
  );
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createSignInHtml(state: "email" | "code" | "loading" | "success", email = "", error = ""): string {
  const safeEmail = escapeHtml(email);
  const safeError = escapeHtml(error);
  const stepLabel = state === "code" ? "Check your inbox" : state === "success" ? "Signed in" : "Welcome back";
  const body =
    state === "success"
      ? `<div class="success">You are signed in as <strong>${safeEmail}</strong>.</div>
         <button id="close" class="primary">Continue</button>`
      : state === "code"
        ? `<p class="muted">We sent a 6-digit verification code to <strong>${safeEmail}</strong>.</p>
           <label for="code">Verification code</label>
           <input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" placeholder="123456" autofocus />
           <button id="verify" class="primary">Verify and sign in</button>
           <button id="back" class="secondary">Use a different email</button>`
        : state === "loading"
          ? `<div class="loader"></div><p class="muted">Contacting Skippr Auth...</p>`
          : `<p class="muted">Sign in with your email. We'll send you a short verification code.</p>
             <label for="email">Email address</label>
             <input id="email" type="email" autocomplete="email" placeholder="you@example.com" value="${safeEmail}" autofocus />
             <button id="send" class="primary">Send verification code</button>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      color: var(--vscode-foreground);
      background:
        radial-gradient(circle at top left, rgba(84, 160, 255, 0.18), transparent 32rem),
        var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
    }
    .card {
      width: min(440px, calc(100vw - 48px));
      padding: 28px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 18px;
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-sideBar-background));
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.28);
    }
    .mark {
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border-radius: 12px;
      margin-bottom: 18px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .eyebrow {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      margin-bottom: 6px;
    }
    .muted { color: var(--vscode-descriptionForeground); line-height: 1.5; }
    label { display: block; margin-top: 22px; margin-bottom: 8px; font-weight: 600; }
    input {
      width: 100%;
      padding: 12px 13px;
      border-radius: 10px;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font: inherit;
      outline: none;
    }
    input:focus {
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-focusBorder) 30%, transparent);
    }
    button {
      width: 100%;
      margin-top: 16px;
      padding: 11px 14px;
      border: 0;
      border-radius: 10px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .primary:hover { background: var(--vscode-button-hoverBackground); }
    .secondary {
      color: var(--vscode-foreground);
      background: var(--vscode-button-secondaryBackground);
    }
    .error {
      margin-top: 16px;
      padding: 10px 12px;
      border-radius: 10px;
      color: var(--vscode-errorForeground);
      background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent);
    }
    .success {
      margin: 22px 0 8px;
      padding: 14px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--vscode-testing-iconPassed) 16%, transparent);
    }
    .loader {
      width: 32px;
      height: 32px;
      border: 3px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
      border-top-color: var(--vscode-button-background);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 24px 0 10px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <main class="card">
    <div class="mark">S</div>
    <div class="eyebrow">${stepLabel}</div>
    <h1>Sign in to Skippr</h1>
    ${body}
    ${safeError ? `<div class="error">${safeError}</div>` : ""}
  </main>
  <script>
    const vscode = acquireVsCodeApi();
    const email = document.getElementById("email");
    const code = document.getElementById("code");
    document.getElementById("send")?.addEventListener("click", () => vscode.postMessage({ command: "email", email: email?.value ?? "" }));
    document.getElementById("verify")?.addEventListener("click", () => vscode.postMessage({ command: "code", code: code?.value ?? "" }));
    document.getElementById("back")?.addEventListener("click", () => vscode.postMessage({ command: "back" }));
    document.getElementById("close")?.addEventListener("click", () => vscode.postMessage({ command: "close" }));
    email?.addEventListener("keydown", event => { if (event.key === "Enter") document.getElementById("send")?.click(); });
    code?.addEventListener("keydown", event => { if (event.key === "Enter") document.getElementById("verify")?.click(); });
  </script>
</body>
</html>`;
}

async function signIn(context: vscode.ExtensionContext, statusItem: vscode.StatusBarItem): Promise<AuthSession | undefined> {
  const panel = vscode.window.createWebviewPanel("skippr.signIn", "Sign in to Skippr", vscode.ViewColumn.Active, {
    enableScripts: true
  });
  let email = "";
  panel.webview.html = createSignInHtml("email");
  return new Promise((resolve) => {
    panel.onDidDispose(() => resolve(undefined));
    panel.webview.onDidReceiveMessage(async (message: { command: string; email?: string; code?: string }) => {
    if (message.command === "close") {
      panel.dispose();
      resolve(undefined);
      return;
    }
    if (message.command === "back") {
      panel.webview.html = createSignInHtml("email", email);
      return;
    }
    if (message.command === "email") {
      email = (message.email ?? "").trim();
      if (!email) {
        panel.webview.html = createSignInHtml("email", email, "Enter your email address.");
        return;
      }
      panel.webview.html = createSignInHtml("loading", email);
      const signInResponse = await apiRequest("/auth/sign-in", "POST", { email });
      panel.webview.html = signInResponse.ok
        ? createSignInHtml("code", email)
        : createSignInHtml("email", email, "We couldn't start sign-in. Check the email and try again.");
      return;
    }
    if (message.command === "code") {
      const code = (message.code ?? "").trim();
      if (!code) {
        panel.webview.html = createSignInHtml("code", email, "Enter the verification code.");
        return;
      }
      panel.webview.html = createSignInHtml("loading", email);
      const confirmResponse = await apiRequest("/auth/confirm", "POST", { email, code });
      if (!confirmResponse.ok) {
        panel.webview.html = createSignInHtml("code", email, "That code is invalid or expired.");
        return;
      }
      const tokenPayload = (await confirmResponse.json()) as { token: string; refresh_token: string };
      const session = {
        token: tokenPayload.token,
        refreshToken: tokenPayload.refresh_token,
        email
      };
      await saveAuthSession(context, session);
      statusItem.text = `$(account) ${email}`;
      statusItem.tooltip = "Signed in to Skippr";
      statusItem.command = "skippr.auth.account";
      panel.webview.html = createSignInHtml("success", email);
      resolve(session);
    }
  });
  });
}

function renderAccountHtml(session: AuthSession, account?: SkipprAccountPayload, error = ""): string {
  const plan = account?.profile?.plan ?? "Unknown";
  const balance = account?.balance?.balance ?? 0;
  const eulaVersion = account?.eula?.version ?? "Not accepted";
  const usage = account?.daily_costs_est?.map((day) => `<li><span>${escapeHtml(day.date)}</span><strong>$${day.cost.toFixed(2)}</strong></li>`).join("") ?? "";
  const recentUsage = account?.recent_usage?.length ?? 0;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 24px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
    .shell { max-width: 760px; margin: 0 auto; }
    .hero { padding: 24px; border: 1px solid var(--vscode-panel-border); border-radius: 18px; background: color-mix(in srgb, var(--vscode-sideBar-background) 70%, transparent); }
    .row { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 16px; }
    .card { flex: 1 1 180px; padding: 16px; border: 1px solid var(--vscode-panel-border); border-radius: 14px; }
    .label { color: var(--vscode-descriptionForeground); font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; }
    .value { font-size: 22px; font-weight: 700; margin-top: 6px; }
    button { margin: 14px 8px 0 0; padding: 9px 12px; border-radius: 9px; border: 0; cursor: pointer; font: inherit; font-weight: 600; }
    .primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .secondary { color: var(--vscode-foreground); background: var(--vscode-button-secondaryBackground); }
    ul { list-style: none; padding: 0; }
    li { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--vscode-panel-border); }
    .error { color: var(--vscode-errorForeground); margin-top: 12px; }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <div class="label">Skippr Account</div>
      <h1>${escapeHtml(session.email)}</h1>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
      <div class="row">
        <div class="card"><div class="label">Plan</div><div class="value">${escapeHtml(plan)}</div></div>
        <div class="card"><div class="label">Balance</div><div class="value">$${balance.toFixed(2)}</div></div>
        <div class="card"><div class="label">Month Estimate</div><div class="value">$${(account?.monthly_cost_est ?? 0).toFixed(2)}</div></div>
      </div>
      <button id="refresh" class="secondary">Refresh</button>
      <button id="buy" class="primary">Buy Credits</button>
      <button id="eula" class="secondary">Accept EULA</button>
      <button id="signout" class="secondary">Sign Out</button>
    </section>
    <section>
      <h2>Usage</h2>
      <p class="label">Recent usage events: ${recentUsage}</p>
      <ul>${usage || "<li><span>No recent daily costs</span><strong>$0.00</strong></li>"}</ul>
      <p class="label">EULA: ${escapeHtml(eulaVersion)} ${account?.eula?.accepted_at ? `(${escapeHtml(account.eula.accepted_at)})` : ""}</p>
      ${account?.subscription ? `<p class="label">Subscription: ${escapeHtml(account.subscription.status ?? "")} ${escapeHtml(account.subscription.price_id ?? "")}</p>` : ""}
    </section>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById("refresh")?.addEventListener("click", () => vscode.postMessage({ command: "refresh" }));
    document.getElementById("buy")?.addEventListener("click", () => vscode.postMessage({ command: "buy" }));
    document.getElementById("eula")?.addEventListener("click", () => vscode.postMessage({ command: "eula" }));
    document.getElementById("signout")?.addEventListener("click", () => vscode.postMessage({ command: "signout" }));
  </script>
</body>
</html>`;
}

async function fetchAccount(session: AuthSession): Promise<SkipprAccountPayload | undefined> {
  const response = await apiRequest("/account", "GET", undefined, session.token);
  return response.ok ? ((await response.json()) as SkipprAccountPayload) : undefined;
}

async function showAccount(context: vscode.ExtensionContext, statusItem: vscode.StatusBarItem): Promise<void> {
  const session = await readAuthSession(context);
  if (!session) {
    await signIn(context, statusItem);
    return;
  }
  const panel = vscode.window.createWebviewPanel("skippr.account", "Skippr Account", vscode.ViewColumn.Active, { enableScripts: true });
  let account = await fetchAccount(session);
  panel.webview.html = renderAccountHtml(session, account, account ? "" : "Could not load account details.");
  panel.webview.onDidReceiveMessage(async (message: { command: string }) => {
    if (message.command === "refresh") {
      account = await fetchAccount(session);
      panel.webview.html = renderAccountHtml(session, account, account ? "" : "Could not load account details.");
    } else if (message.command === "buy") {
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
    } else if (message.command === "eula") {
      await apiRequest("/auth/accept-eula", "POST", { version: "skippr-eula-2026-04-29" }, session.token);
      account = await fetchAccount(session);
      panel.webview.html = renderAccountHtml(session, account);
    } else if (message.command === "signout") {
      await clearAuthSession(context);
      statusItem.text = "$(sign-in) Skippr Sign In";
      statusItem.tooltip = "Sign in to Skippr";
      panel.dispose();
    }
  });
}

async function ensureSession(context: vscode.ExtensionContext, statusItem: vscode.StatusBarItem): Promise<AuthSession | undefined> {
  const existing = await readAuthSession(context);
  if (!existing) {
    statusItem.text = "$(sign-in) Skippr Sign In";
    statusItem.tooltip = "Sign in to Skippr";
    statusItem.command = "skippr.auth.account";
    return undefined;
  }

  const sessionResponse = await apiRequest("/auth/session", "GET", undefined, existing.token);
  if (sessionResponse.ok) {
    statusItem.text = `$(account) ${existing.email}`;
    statusItem.tooltip = "Signed in to Skippr";
    statusItem.command = "skippr.auth.account";
    return existing;
  }

  const refreshResponse = await apiRequest("/auth/refresh", "POST", { refresh_token: existing.refreshToken });
  if (!refreshResponse.ok) {
    await clearAuthSession(context);
    statusItem.text = "$(sign-in) Skippr Sign In";
    statusItem.tooltip = "Sign in to Skippr";
    statusItem.command = "skippr.auth.account";
    return undefined;
  }

  const refreshed = (await refreshResponse.json()) as { token: string; refresh_token: string };
  const next: AuthSession = { token: refreshed.token, refreshToken: refreshed.refresh_token, email: existing.email };
  await saveAuthSession(context, next);
  statusItem.text = `$(account) ${existing.email}`;
  statusItem.tooltip = "Signed in to Skippr";
  statusItem.command = "skippr.auth.account";
  return next;
}

function createSplashHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 24px; }
    .hero { font-size: 24px; font-weight: 700; margin-bottom: 12px; }
    .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 20px; }
    ul { line-height: 1.7; }
    .actions { margin-top: 24px; display: flex; gap: 10px; flex-wrap: wrap; }
    button { cursor: pointer; padding: 8px 12px; }
  </style>
</head>
<body>
  <div class="hero">Skippr IDE</div>
  <div class="subtitle">Build reliable data platforms with Skippr Data Agent and Skippr Data Engineer Agent workflows.</div>
  <ul>
    <li>Discover and profile data sources</li>
    <li>Sync data pipelines and monitor changes</li>
    <li>Author and validate models with lineage context</li>
    <li>Use Skippr Data Agent flows to plan and deliver data engineering work</li>
  </ul>
  <div class="actions">
    <button id="signin">Sign In To Skippr</button>
    <button id="discover">Open Discover</button>
    <button id="continue">Continue Without Login</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById("signin")?.addEventListener("click", () => vscode.postMessage({ command: "signIn" }));
    document.getElementById("discover")?.addEventListener("click", () => vscode.postMessage({ command: "openDiscover" }));
    document.getElementById("continue")?.addEventListener("click", () => vscode.postMessage({ command: "close" }));
  </script>
</body>
</html>`;
}

function renderPanelHtml(payload: SkipprPanelPayload, session?: AuthSession): string {
  const resources = payload.resources
    .map((resource) => `<li><strong>${resource.label}</strong><br /><span>${resource.path}</span></li>`)
    .join("");
  const catalog = payload.catalog.map((entry) => `<li>${entry.name} (${entry.owner})</li>`).join("");
  const lineage = payload.lineage.edges.map((edge) => `${edge.from} -> ${edge.to}`).join("<br />");
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
      <div class="section"><div class="title">Lineage</div><div>${lineage || "No edges."}</div></div>
      <div class="section"><div class="title">Agent Debug Logs</div><ul>${diagnostics}</ul></div>
    </aside>
  </div>
</body>
</html>`;
}

async function openPanel(context: vscode.ExtensionContext, panelId: SkipprPanelId, panelName: SkipprPanelName, statusItem: vscode.StatusBarItem): Promise<void> {
  const session = await ensureSession(context, statusItem);
  const payload = await loadPanelPayloadFromRust(context.extensionPath, panelId, panelName, loadConnectionSettings());
  const panel = vscode.window.createWebviewPanel(
    `skippr.${panelId}`,
    `Skippr ${panelName}`,
    vscode.ViewColumn.Active,
    { enableScripts: true }
  );
  panel.webview.html = renderPanelHtml(payload, session);
}

class SkipprRunDebugViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { padding: 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    .title { font-weight: 700; margin-bottom: 6px; }
    .muted { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.4; margin-bottom: 12px; }
    button { width: 100%; margin: 0 0 8px; padding: 8px 10px; border: 0; border-radius: 6px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; font: inherit; font-weight: 600; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .secondary { color: var(--vscode-foreground); background: var(--vscode-button-secondaryBackground); }
  </style>
</head>
<body>
  <div class="title">Skippr</div>
  <div class="muted">Run data discovery, sync, and model tools from this workspace.</div>
  <button data-command="skippr.run.discoverPipeline">Discover</button>
  <button data-command="skippr.run.syncPipelineOnce">Sync</button>
  <button data-command="skippr.run.modelPipeline" class="secondary">Model</button>
  <button data-command="skippr.setupWorkspace" class="secondary">Setup Workspace</button>
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll("button[data-command]").forEach(button => {
      button.addEventListener("click", () => vscode.postMessage({ command: button.dataset.command }));
    });
  </script>
</body>
</html>`;
    webviewView.webview.onDidReceiveMessage(async (message: { command?: string }) => {
      if (message.command) {
        await vscode.commands.executeCommand(message.command);
      }
    }, undefined, this.context.subscriptions);
  }
}

async function showSplash(context: vscode.ExtensionContext, statusItem: vscode.StatusBarItem): Promise<void> {
  const panel = vscode.window.createWebviewPanel("skippr.splash", "Welcome to Skippr IDE", vscode.ViewColumn.Active, {
    enableScripts: true
  });
  panel.webview.html = createSplashHtml();
  panel.webview.onDidReceiveMessage(async (message: { command: string }) => {
    if (message.command === "signIn") {
      await signIn(context, statusItem);
    } else if (message.command === "openDiscover") {
      await vscode.commands.executeCommand("skippr.open.discover");
      panel.dispose();
    } else if (message.command === "close") {
      panel.dispose();
    }
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
  statusItem.command = "skippr.auth.account";
  statusItem.text = "$(sign-in) Skippr Sign In";
  statusItem.show();
  context.subscriptions.push(statusItem);

  const runStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 999);
  setRunStatusIdle(runStatusItem);
  runStatusItem.show();

  const output = vscode.window.createOutputChannel("Skippr", { log: true });
  context.subscriptions.push(runStatusItem, output);
  context.subscriptions.push(
    vscode.authentication.registerAuthenticationProvider("skippr", "Skippr", new SkipprAuthenticationProvider(context, statusItem), {
      supportsMultipleAccounts: false
    })
  );
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("skippr.runDebug", new SkipprRunDebugViewProvider(context)));
  registerSkipprChatParticipant(context, output, runStatusItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("skippr.configureConnection", async () => {
      await configureConnection();
    }),
    vscode.commands.registerCommand("skippr.auth.signIn", async () => {
      await signIn(context, statusItem);
    }),
    vscode.commands.registerCommand("skippr.auth.account", async () => {
      await showAccount(context, statusItem);
    }),
    vscode.commands.registerCommand("skippr.auth.signOut", async () => {
      const session = await readAuthSession(context);
      if (session) {
        await apiRequest("/auth/logout", "POST", undefined, session.token);
      }
      await clearAuthSession(context);
      statusItem.text = "$(sign-in) Skippr Sign In";
      statusItem.tooltip = "Sign in to Skippr";
      statusItem.command = "skippr.auth.account";
      vscode.window.showInformationMessage("Signed out from Skippr.");
    }),
    vscode.commands.registerCommand("skippr.openSplash", async () => {
      await showSplash(context, statusItem);
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
      const result = await updateSkipprCli(cliPath, output);
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
      const result = await showSkipprVersion(cliPath, output);
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
      await runSkipprCommand("model", output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.run.pickPipelineAction", async (configFsPath: unknown, pipeline: unknown) => {
      await runPickPipelineAction(configFsPath, pipeline, output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.chat.runMode", async (modeId: unknown) => {
      if (!isSkipprChatModeId(modeId)) {
        vscode.window.showErrorMessage("Invalid Skippr chat mode. Expected ask, plan, or agent.");
        return;
      }
      await runSkipprChatMode(modeId, output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.chat.ask", async () => {
      await runSkipprChatMode("ask", output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.chat.plan", async () => {
      await runSkipprChatMode("plan", output, runStatusItem);
    }),
    vscode.commands.registerCommand("skippr.chat.runModelSubagent", async () => {
      await runSkipprChatMode("agent", output, runStatusItem);
    }),
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
      provideDebugConfigurations: () => [
        {
          type: "skippr",
          request: "launch",
          name: "Skippr: Discover",
          skipprKind: "discover",
          configPath: "${workspaceFolder}/skippr.yml",
          logLevel: getLogLevel(),
          pipeline: "${config:skippr.defaultPipeline}"
        },
        {
          type: "skippr",
          request: "launch",
          name: "Skippr: Sync",
          skipprKind: "sync-once",
          configPath: "${workspaceFolder}/skippr.yml",
          logLevel: getLogLevel(),
          pipeline: "${config:skippr.defaultPipeline}"
        },
        {
          type: "skippr",
          request: "launch",
          name: "Skippr: Model",
          skipprKind: "model",
          configPath: "${workspaceFolder}/skippr.yml",
          logLevel: getLogLevel(),
          pipeline: "${config:skippr.defaultPipeline}"
        }
      ],
      resolveDebugConfiguration: (folder, configuration) => {
        if (!configuration.type) {
          return {
            type: "skippr",
            request: "launch",
            name: "Skippr: Discover",
            skipprKind: "discover",
            configPath: "${workspaceFolder}/skippr.yml",
            logLevel: getLogLevel(),
            pipeline: "${config:skippr.defaultPipeline}"
          };
        }
        if (configuration.type !== "skippr") {
          return configuration;
        }
        const next: vscode.DebugConfiguration = { ...configuration };
        const kind = next.skipprKind;
        if (isSkipprRunKind(kind) && kind !== "sync-all-once" && !String(next.pipeline ?? "").trim()) {
          const def = vscode.workspace.getConfiguration("skippr", folder?.uri).get<string>("defaultPipeline", "")?.trim();
          if (def) {
            next.pipeline = def;
          }
        }
        return next;
      }
    })
  );

  registerSkipprPipelineTestController(context, (configFsPath, pipeline) =>
    runPickPipelineAction(configFsPath, pipeline, output, runStatusItem)
  );

  for (const panel of panelSpecs) {
    context.subscriptions.push(
      vscode.commands.registerCommand(panel.command, async () => {
        if (panel.id === "skippr.model") {
          await runSkipprCommand("model", output, runStatusItem);
          return;
        }
        await openPanel(context, panel.id, panel.name, statusItem);
      })
    );
  }

  void ensureSession(context, statusItem);
  const configWatcher = vscode.workspace.createFileSystemWatcher("**/skippr.{yml,yaml}");
  context.subscriptions.push(
    configWatcher,
    configWatcher.onDidCreate(() => {
      void chooseActiveConfig(output).then(() => refreshConfigStatus(output, runStatusItem));
    }),
    configWatcher.onDidChange(() => {
      void refreshConfigStatus(output, runStatusItem);
    }),
    configWatcher.onDidDelete(() => {
      activeConfigPath = undefined;
      void chooseActiveConfig(output).then(() => refreshConfigStatus(output, runStatusItem));
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      activeConfigPath = undefined;
      void chooseActiveConfig(output).then(() => refreshConfigStatus(output, runStatusItem));
    })
  );
  void chooseActiveConfig(output).then(() => refreshConfigStatus(output, runStatusItem));
  if (!context.globalState.get<boolean>(splashSeenKey)) {
    void context.globalState.update(splashSeenKey, true);
    void showSplash(context, statusItem);
  }
}

export function deactivate(): void {}
