import * as vscode from "vscode";
import { loadPanelPayloadFromRust } from "./rustBridge";
import {
  installSkipprCli,
  isSkipprRunKind,
  resolveSkipprCli,
  showSkipprVersion,
  SkipprProcess,
  SkipprRunKind,
  startSkipprRun,
  updateSkipprCli
} from "./skipprRunner";
import { ConnectionSettings, SkipprPanelId, SkipprPanelName, SkipprPanelPayload, SkipprRunEvent } from "./types";

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

let activeRun: SkipprProcess | undefined;

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

async function configureConnection(): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const currentWorkspacePath = config.get<string>(workspacePathKey, "");
  const currentApiTarget = config.get<string>(apiTargetKey, "");

  const workspacePath = await vscode.window.showInputBox({
    title: "Skippr Workspace Path",
    value: currentWorkspacePath,
    prompt: "Path to local Skippr workspace",
    ignoreFocusOut: true
  });
  if (workspacePath === undefined) {
    return;
  }

  const apiTarget = await vscode.window.showInputBox({
    title: "Skippr API Target (Optional)",
    value: currentApiTarget,
    prompt: "Optional backend API URL",
    ignoreFocusOut: true
  });
  if (apiTarget === undefined) {
    return;
  }

  await config.update(workspacePathKey, workspacePath.trim(), vscode.ConfigurationTarget.Global);
  await config.update(apiTargetKey, apiTarget.trim(), vscode.ConfigurationTarget.Global);
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

async function promptForPipeline(title: string): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration();
  const current = config.get<string>(defaultPipelineKey, "").trim();
  const pipeline = await vscode.window.showInputBox({
    title,
    value: current,
    prompt: "Skippr pipeline name",
    ignoreFocusOut: true
  });
  if (!pipeline) {
    return undefined;
  }
  const trimmed = pipeline.trim();
  await config.update(defaultPipelineKey, trimmed, vscode.ConfigurationTarget.Global);
  return trimmed;
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
  requestedPipeline?: string
): Promise<void> {
  if (activeRun) {
    vscode.window.showWarningMessage(`Skippr is already running: ${activeRun.label}`);
    output.show(true);
    return;
  }

  const pipeline =
    kind === "sync-all-once"
      ? undefined
      : requestedPipeline?.trim() || (await promptForPipeline(kind === "discover" ? "Discover Skippr Pipeline" : "Sync Skippr Pipeline"));
  if (kind !== "sync-all-once" && !pipeline) {
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
      cwd: getRunCwd(),
      pipeline,
      logLevel: getLogLevel()
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
    setRunStatusIdle(statusItem);
    vscode.window.showInformationMessage(`${run.label} completed.`);
  } else if (result.signal) {
    output.warn(`${run.label} stopped by signal ${result.signal}.`);
    setRunStatusIdle(statusItem);
  } else {
    output.error(`${run.label} failed with exit code ${result.code}.`);
    setRunStatusIdle(statusItem);
    vscode.window.showErrorMessage(`${run.label} failed. See Skippr output for details.`);
  }
}

async function runSkipprDebugConfiguration(
  configuration: vscode.DebugConfiguration,
  output: vscode.LogOutputChannel,
  statusItem: vscode.StatusBarItem
): Promise<void> {
  if (!isSkipprRunKind(configuration.skipprKind)) {
    output.error(`Invalid Skippr debug configuration kind: ${String(configuration.skipprKind)}`);
    vscode.window.showErrorMessage("Invalid Skippr debug configuration. Expected skipprKind discover, sync-once, sync-all-once, or sync.");
    return;
  }
  const pipeline = typeof configuration.pipeline === "string" ? configuration.pipeline : undefined;
  await runSkipprCommand(configuration.skipprKind, output, statusItem, pipeline);
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

async function signIn(context: vscode.ExtensionContext, statusItem: vscode.StatusBarItem): Promise<void> {
  const email = await vscode.window.showInputBox({
    title: "Skippr Sign In",
    prompt: "Email address",
    placeHolder: "user@example.com",
    ignoreFocusOut: true
  });
  if (!email) {
    return;
  }

  const signInResponse = await apiRequest("/auth/sign-in", "POST", { email });
  if (!signInResponse.ok) {
    vscode.window.showErrorMessage("Skippr sign-in failed to start.");
    return;
  }

  const code = await vscode.window.showInputBox({
    title: "Skippr Verification Code",
    prompt: "Enter the 6-digit code sent to your email",
    placeHolder: "123456",
    ignoreFocusOut: true
  });
  if (!code) {
    return;
  }

  const confirmResponse = await apiRequest("/auth/confirm", "POST", { email, code });
  if (!confirmResponse.ok) {
    vscode.window.showErrorMessage("Skippr verification code is invalid or expired.");
    return;
  }

  const tokenPayload = (await confirmResponse.json()) as { token: string; refresh_token: string };
  await saveAuthSession(context, {
    token: tokenPayload.token,
    refreshToken: tokenPayload.refresh_token,
    email
  });
  statusItem.text = `$(account) ${email}`;
  statusItem.tooltip = "Signed in to Skippr";
  vscode.window.showInformationMessage("Signed in to Skippr.");
}

async function ensureSession(context: vscode.ExtensionContext, statusItem: vscode.StatusBarItem): Promise<AuthSession | undefined> {
  const existing = await readAuthSession(context);
  if (!existing) {
    statusItem.text = "$(sign-in) Skippr Sign In";
    statusItem.tooltip = "Sign in to Skippr";
    return undefined;
  }

  const sessionResponse = await apiRequest("/auth/session", "GET", undefined, existing.token);
  if (sessionResponse.ok) {
    statusItem.text = `$(account) ${existing.email}`;
    statusItem.tooltip = "Signed in to Skippr";
    return existing;
  }

  const refreshResponse = await apiRequest("/auth/refresh", "POST", { refresh_token: existing.refreshToken });
  if (!refreshResponse.ok) {
    await clearAuthSession(context);
    statusItem.text = "$(sign-in) Skippr Sign In";
    statusItem.tooltip = "Sign in to Skippr";
    return undefined;
  }

  const refreshed = (await refreshResponse.json()) as { token: string; refresh_token: string };
  const next: AuthSession = { token: refreshed.token, refreshToken: refreshed.refresh_token, email: existing.email };
  await saveAuthSession(context, next);
  statusItem.text = `$(account) ${existing.email}`;
  statusItem.tooltip = "Signed in to Skippr";
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
  statusItem.command = "skippr.auth.signIn";
  statusItem.text = "$(sign-in) Skippr Sign In";
  statusItem.show();
  context.subscriptions.push(statusItem);

  const runStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 999);
  setRunStatusIdle(runStatusItem);
  runStatusItem.show();

  const output = vscode.window.createOutputChannel("Skippr", { log: true });
  context.subscriptions.push(runStatusItem, output);

  context.subscriptions.push(
    vscode.commands.registerCommand("skippr.configureConnection", async () => {
      await configureConnection();
      vscode.window.showInformationMessage("Skippr connection settings saved.");
    }),
    vscode.commands.registerCommand("skippr.auth.signIn", async () => {
      await signIn(context, statusItem);
    }),
    vscode.commands.registerCommand("skippr.auth.signOut", async () => {
      const session = await readAuthSession(context);
      if (session) {
        await apiRequest("/auth/logout", "POST", undefined, session.token);
      }
      await clearAuthSession(context);
      statusItem.text = "$(sign-in) Skippr Sign In";
      statusItem.tooltip = "Sign in to Skippr";
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
          name: "Skippr: Discover Pipeline",
          skipprKind: "discover"
        },
        {
          type: "skippr",
          request: "launch",
          name: "Skippr: Sync Pipeline Once",
          skipprKind: "sync-once"
        },
        {
          type: "skippr",
          request: "launch",
          name: "Skippr: Sync All Once",
          skipprKind: "sync-all-once"
        },
        {
          type: "skippr",
          request: "launch",
          name: "Skippr: Start Pipeline Sync",
          skipprKind: "sync"
        }
      ],
      resolveDebugConfiguration: (_folder, configuration) => {
        if (!configuration.type) {
          return {
            type: "skippr",
            request: "launch",
            name: "Skippr: Discover Pipeline",
            skipprKind: "discover"
          };
        }
        return configuration;
      }
    })
  );

  for (const panel of panelSpecs) {
    context.subscriptions.push(
      vscode.commands.registerCommand(panel.command, async () => {
        await openPanel(context, panel.id, panel.name, statusItem);
      })
    );
  }

  void ensureSession(context, statusItem);
  if (!context.globalState.get<boolean>(splashSeenKey)) {
    void context.globalState.update(splashSeenKey, true);
    void showSplash(context, statusItem);
  }
}

export function deactivate(): void {}
