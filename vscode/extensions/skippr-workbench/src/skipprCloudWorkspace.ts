import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { parseJwtTenantId } from "./skipprJwt";

/** Synced to S3 as `workspace.json` (no secrets). */
export interface CloudWorkspacePrefs {
  version: number;
  defaultPipeline?: string;
}

export interface CloudWorkspaceBundle {
  configYaml: string;
  workspacePrefs?: CloudWorkspacePrefs;
  etag?: string;
}

export interface CloudWorkspaceContext {
  tenantId: string;
  workspace: string;
  configPath: string;
  projectRoot: string;
}

export interface CloudWorkspaceActiveFile {
  tenantId: string;
  workspace: string;
  configPath: string;
  projectRoot: string;
}

const CLOUD_CONTEXT_KEY = "skippr.cloudWorkspaceContext";
const CLOUD_PREFER_KEY = "skippr.cloudWorkspacePreferred";
const PREFS_VERSION = 1;

let workbenchContext: vscode.ExtensionContext | undefined;
let lastAuthToken: string | undefined;

export function setLastAuthToken(token: string | undefined): void {
  lastAuthToken = token;
}

export function getLastAuthToken(): string | undefined {
  return lastAuthToken;
}

export function setCloudWorkbenchContext(context: vscode.ExtensionContext): void {
  workbenchContext = context;
}

export function getCloudWorkbenchContext(): vscode.ExtensionContext | undefined {
  return workbenchContext;
}

type ApiRequestFn = (
  path: string,
  method: string,
  body?: unknown,
  token?: string
) => Promise<Response>;

export { parseJwtEmail, parseJwtTenantId } from "./skipprJwt";

export function cloudCacheDir(projectRoot: string, tenantId: string, workspace: string): string {
  return path.join(projectRoot, ".skippr", "cloud-workspaces", tenantId, workspace);
}

export function cloudCacheConfigPath(projectRoot: string, tenantId: string, workspace: string): string {
  return path.join(cloudCacheDir(projectRoot, tenantId, workspace), "skippr.yml");
}

export function cloudCachePrefsPath(projectRoot: string, tenantId: string, workspace: string): string {
  return path.join(cloudCacheDir(projectRoot, tenantId, workspace), "workspace.json");
}

export function cloudActiveFilePath(projectRoot: string): string {
  return path.join(projectRoot, ".skippr", "cloud-workspaces", "active.json");
}

/** `skippr.workspace` from YAML, or cloud cache workspace name when applicable. */
export async function workspaceSlugFromConfigPath(
  configPath: string,
  cloud?: CloudWorkspaceContext
): Promise<string | undefined> {
  if (cloud?.workspace?.trim()) {
    return cloud.workspace.trim();
  }
  if (!configPath.trim()) {
    return undefined;
  }
  try {
    const raw = await fs.promises.readFile(configPath, "utf8");
    const direct = raw.match(/(?:^|\n)\s*workspace:\s*["']?([^"'\n#]+)/);
    if (direct?.[1]) {
      return direct[1].trim();
    }
    const nested = raw.match(/(?:^|\n)\s*skippr:\s*[\s\S]*?\n\s*workspace:\s*["']?([^"'\n#]+)/);
    return nested?.[1]?.trim();
  } catch {
    return undefined;
  }
}

export function chatThreadStorePath(projectRoot: string): string {
  return path.join(projectRoot, ".skippr", "ide", "chat-thread.json");
}

export function isCloudCachedConfigPath(configPath: string | undefined): boolean {
  if (!configPath?.trim()) {
    return false;
  }
  const normalized = path.resolve(configPath);
  const marker = `${path.sep}.skippr${path.sep}cloud-workspaces${path.sep}`;
  return normalized.includes(marker) && normalized.endsWith(`${path.sep}skippr.yml`);
}

export function isCloudWorkspaceCacheFile(filePath: string | undefined): boolean {
  if (!filePath?.trim()) {
    return false;
  }
  const normalized = path.resolve(filePath);
  const marker = `${path.sep}.skippr${path.sep}cloud-workspaces${path.sep}`;
  if (!normalized.includes(marker)) {
    return false;
  }
  return (
    normalized.endsWith(`${path.sep}skippr.yml`) || normalized.endsWith(`${path.sep}workspace.json`)
  );
}

export async function listCloudWorkspaces(
  apiRequest: ApiRequestFn,
  token: string
): Promise<string[]> {
  const response = await apiRequest("/auth/workspaces", "GET", undefined, token);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `list workspaces failed (${response.status})`);
  }
  const payload = (await response.json()) as { workspaces?: string[] };
  return payload.workspaces ?? [];
}

export async function fetchCloudWorkspaceBundle(
  apiRequest: ApiRequestFn,
  token: string,
  workspace: string
): Promise<CloudWorkspaceBundle> {
  const response = await apiRequest(
    `/auth/workspaces/${encodeURIComponent(workspace)}/config`,
    "GET",
    undefined,
    token
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `fetch workspace failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    config_yaml?: string;
    workspace_prefs?: CloudWorkspacePrefs;
    etag?: string;
  };
  if (!payload.config_yaml?.trim()) {
    throw new Error("empty config from server");
  }
  return {
    configYaml: payload.config_yaml,
    workspacePrefs: payload.workspace_prefs,
    etag: payload.etag
  };
}

export async function createCloudWorkspace(
  apiRequest: ApiRequestFn,
  token: string,
  workspace: string,
  configYaml: string,
  workspacePrefs?: CloudWorkspacePrefs
): Promise<void> {
  const response = await apiRequest(
    "/auth/workspaces",
    "POST",
    { workspace, config_yaml: configYaml, workspace_prefs: workspacePrefs },
    token
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `create workspace failed (${response.status})`);
  }
}

export async function updateCloudWorkspace(
  apiRequest: ApiRequestFn,
  token: string,
  workspace: string,
  body: { configYaml?: string; workspacePrefs?: CloudWorkspacePrefs }
): Promise<void> {
  const response = await apiRequest(
    `/auth/workspaces/${encodeURIComponent(workspace)}`,
    "PUT",
    {
      ...(body.configYaml !== undefined ? { config_yaml: body.configYaml } : {}),
      ...(body.workspacePrefs !== undefined ? { workspace_prefs: body.workspacePrefs } : {})
    },
    token
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `update workspace failed (${response.status})`);
  }
}

export function readLocalChatThreads(projectRoot: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(chatThreadStorePath(projectRoot), "utf8");
    const parsed = JSON.parse(raw) as { threads?: Record<string, string> };
    return parsed.threads ?? {};
  } catch {
    return {};
  }
}

export function writeLocalChatThreads(projectRoot: string, threads: Record<string, string>): void {
  const storePath = chatThreadStorePath(projectRoot);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify({ threads }, null, 2), "utf8");
}

export function collectWorkspacePrefsFromLocal(
  projectRoot: string,
  folderUri: vscode.Uri | undefined
): CloudWorkspacePrefs {
  const conf = vscode.workspace.getConfiguration("skippr", folderUri);
  const defaultPipeline = conf.get<string>("defaultPipeline", "").trim() || undefined;
  const prefs: CloudWorkspacePrefs = { version: PREFS_VERSION };
  if (defaultPipeline) {
    prefs.defaultPipeline = defaultPipeline;
  }
  return prefs;
}

export async function applyWorkspacePrefsToLocal(
  projectRoot: string,
  prefs: CloudWorkspacePrefs | undefined,
  folderUri: vscode.Uri | undefined
): Promise<void> {
  if (!prefs) {
    return;
  }
  if (prefs.defaultPipeline?.trim()) {
    const conf = vscode.workspace.getConfiguration("skippr", folderUri);
    await conf.update("defaultPipeline", prefs.defaultPipeline.trim(), vscode.ConfigurationTarget.WorkspaceFolder);
  }
}

async function writeCacheFiles(
  projectRoot: string,
  tenantId: string,
  workspace: string,
  bundle: CloudWorkspaceBundle
): Promise<string> {
  const dir = cloudCacheDir(projectRoot, tenantId, workspace);
  const configPath = cloudCacheConfigPath(projectRoot, tenantId, workspace);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(configPath, bundle.configYaml, "utf8");
  if (bundle.workspacePrefs) {
    await fs.promises.writeFile(
      cloudCachePrefsPath(projectRoot, tenantId, workspace),
      JSON.stringify(bundle.workspacePrefs, null, 2),
      "utf8"
    );
  }
  const active: CloudWorkspaceActiveFile = {
    tenantId,
    workspace,
    configPath,
    projectRoot
  };
  await fs.promises.mkdir(path.dirname(cloudActiveFilePath(projectRoot)), { recursive: true });
  await fs.promises.writeFile(cloudActiveFilePath(projectRoot), JSON.stringify(active, null, 2), "utf8");
  return configPath;
}

export function getActiveCloudContext(
  context: vscode.ExtensionContext
): CloudWorkspaceContext | undefined {
  return context.globalState.get<CloudWorkspaceContext>(CLOUD_CONTEXT_KEY);
}

export async function setActiveCloudWorkspace(
  context: vscode.ExtensionContext,
  active: CloudWorkspaceContext
): Promise<void> {
  await context.globalState.update(CLOUD_CONTEXT_KEY, active);
  await context.globalState.update(CLOUD_PREFER_KEY, true);
  await vscode.commands.executeCommand("setContext", "skippr.cloudWorkspaceActive", true);
}

export async function clearActiveCloudWorkspace(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(CLOUD_CONTEXT_KEY, undefined);
  await context.globalState.update(CLOUD_PREFER_KEY, false);
  await vscode.commands.executeCommand("setContext", "skippr.cloudWorkspaceActive", false);
}

export function cloudWorkspacePreferred(context: vscode.ExtensionContext): boolean {
  return context.globalState.get<boolean>(CLOUD_PREFER_KEY, false);
}

export async function loadCloudContextFromActiveFile(
  context: vscode.ExtensionContext,
  projectRoot: string
): Promise<CloudWorkspaceContext | undefined> {
  try {
    const raw = await fs.promises.readFile(cloudActiveFilePath(projectRoot), "utf8");
    const parsed = JSON.parse(raw) as CloudWorkspaceActiveFile;
    if (
      !parsed.tenantId?.trim() ||
      !parsed.workspace?.trim() ||
      !parsed.configPath?.trim() ||
      !parsed.projectRoot?.trim()
    ) {
      return undefined;
    }
    const active: CloudWorkspaceContext = {
      tenantId: parsed.tenantId,
      workspace: parsed.workspace,
      configPath: parsed.configPath,
      projectRoot: parsed.projectRoot
    };
    await setActiveCloudWorkspace(context, active);
    return active;
  } catch {
    return undefined;
  }
}

export function getCloudProjectRootForConfig(
  context: vscode.ExtensionContext,
  configPath: string | undefined
): string | undefined {
  if (!configPath || !isCloudCachedConfigPath(configPath)) {
    return undefined;
  }
  const active = getActiveCloudContext(context);
  if (!active) {
    return undefined;
  }
  const normalized = path.resolve(configPath);
  if (path.resolve(active.configPath) !== normalized) {
    return undefined;
  }
  return active.projectRoot;
}

function resolveProjectRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function ensureProjectFolder(): Promise<string | undefined> {
  const existing = resolveProjectRoot();
  if (existing) {
    return existing;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Open project folder for cloud workspace",
    title: "Select a folder for pipeline files (bike_hire/, etc.)"
  });
  if (!picked?.[0]) {
    return undefined;
  }
  await vscode.commands.executeCommand("vscode.openFolder", picked[0], { forceNewWindow: false });
  return picked[0].fsPath;
}

export async function openCloudWorkspace(
  context: vscode.ExtensionContext,
  apiRequest: ApiRequestFn,
  token: string,
  workspace: string,
  tenantId?: string
): Promise<CloudWorkspaceContext | undefined> {
  const tid = tenantId?.trim() || parseJwtTenantId(token);
  if (!tid) {
    throw new Error("Missing tenant_id in session — sign in again.");
  }
  const projectRoot = await ensureProjectFolder();
  if (!projectRoot) {
    return undefined;
  }
  const bundle = await fetchCloudWorkspaceBundle(apiRequest, token, workspace);
  const configPath = await writeCacheFiles(projectRoot, tid, workspace, bundle);
  const folderUri = vscode.Uri.file(projectRoot);
  await applyWorkspacePrefsToLocal(projectRoot, bundle.workspacePrefs, folderUri);
  const active: CloudWorkspaceContext = {
    tenantId: tid,
    workspace,
    configPath,
    projectRoot
  };
  await setActiveCloudWorkspace(context, active);
  return active;
}

export async function saveActiveCloudWorkspace(
  context: vscode.ExtensionContext,
  apiRequest: ApiRequestFn,
  token: string
): Promise<void> {
  const active = getActiveCloudContext(context);
  if (!active) {
    throw new Error("No active cloud workspace.");
  }
  const configYaml = await fs.promises.readFile(active.configPath, "utf8");
  const folderUri = vscode.Uri.file(active.projectRoot);
  const workspacePrefs = collectWorkspacePrefsFromLocal(active.projectRoot, folderUri);
  await updateCloudWorkspace(apiRequest, token, active.workspace, { configYaml, workspacePrefs });
  await fs.promises.writeFile(
    cloudCachePrefsPath(active.projectRoot, active.tenantId, active.workspace),
    JSON.stringify(workspacePrefs, null, 2),
    "utf8"
  );
}

export async function promptAndOpenCloudWorkspace(
  context: vscode.ExtensionContext,
  apiRequest: ApiRequestFn,
  ensureSession: () => Promise<{ token: string } | undefined>
): Promise<CloudWorkspaceContext | undefined> {
  const session = await ensureSession();
  if (!session) {
    return undefined;
  }
  const names = await listCloudWorkspaces(apiRequest, session.token);
  if (names.length === 0) {
    vscode.window.showInformationMessage(
      "No cloud workspaces yet. Use File → New Cloud Workspace to create one."
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(names, {
    title: "Open Cloud Workspace",
    placeHolder: "Select a workspace"
  });
  if (!picked) {
    return undefined;
  }
  const active = await openCloudWorkspace(context, apiRequest, session.token, picked);
  if (active) {
    vscode.window.showInformationMessage(`Opened cloud workspace ${active.workspace}.`);
  }
  return active;
}

export async function promptAndCreateCloudWorkspace(
  context: vscode.ExtensionContext,
  apiRequest: ApiRequestFn,
  ensureSession: () => Promise<{ token: string } | undefined>
): Promise<void> {
  const session = await ensureSession();
  if (!session) {
    return;
  }
  const workspace = await vscode.window.showInputBox({
    title: "New Cloud Workspace",
    prompt: "Workspace name (must match skippr.workspace in YAML)",
    placeHolder: "mssql-migration",
    validateInput: (v) =>
      /^[a-zA-Z0-9_-]+$/.test(v.trim()) ? undefined : "Use letters, digits, underscore, or hyphen"
  });
  if (!workspace?.trim()) {
    return;
  }
  let configYaml = "";
  const projectRoot = resolveProjectRoot();
  if (projectRoot) {
    for (const name of ["skippr.yml", "skippr.yaml"]) {
      const local = path.join(projectRoot, name);
      if (fs.existsSync(local)) {
        const useLocal = await vscode.window.showQuickPick(
          ["Use workspace root skippr.yml", "Start from template"],
          { title: "Cloud workspace YAML source" }
        );
        if (useLocal === "Use workspace root skippr.yml") {
          configYaml = await fs.promises.readFile(local, "utf8");
          break;
        }
      }
    }
  }
  if (!configYaml) {
    const importPick = await vscode.window.showQuickPick(["Import YAML file", "Edit template"], {
      title: "Provide skippr.yml content"
    });
    if (importPick === "Import YAML file") {
      const files = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { YAML: ["yml", "yaml"] }
      });
      if (files?.[0]) {
        configYaml = await fs.promises.readFile(files[0].fsPath, "utf8");
      }
    } else if (importPick === "Edit template") {
      const doc = await vscode.workspace.openTextDocument({
        language: "yaml",
        content: `skippr:\n  workspace: ${workspace.trim()}\npipelines:\n  main: {}\n`
      });
      await vscode.window.showTextDocument(doc);
      const done = await vscode.window.showInformationMessage(
        "Edit the YAML, then create the cloud workspace.",
        "Create now"
      );
      if (done === "Create now") {
        configYaml = doc.getText();
      }
    }
  }
  if (!configYaml.trim()) {
    return;
  }
  const folderUri = projectRoot ? vscode.Uri.file(projectRoot) : undefined;
  const workspacePrefs = projectRoot
    ? collectWorkspacePrefsFromLocal(projectRoot, folderUri)
    : { version: PREFS_VERSION };
  await createCloudWorkspace(apiRequest, session.token, workspace.trim(), configYaml, workspacePrefs);
  vscode.window.showInformationMessage(`Cloud workspace ${workspace.trim()} created.`, "Open now").then(async (choice) => {
    if (choice === "Open now") {
      await openCloudWorkspace(context, apiRequest, session.token, workspace.trim());
    }
  });
}
