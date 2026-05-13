import * as vscode from "vscode";
import { loadPanelPayloadFromRust } from "./rustBridge";
import { ConnectionSettings, SkipprPanelId, SkipprPanelName, SkipprPanelPayload } from "./types";

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

interface AuthSession {
  token: string;
  refreshToken: string;
  email: string;
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
