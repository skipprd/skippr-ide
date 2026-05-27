import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { renderDashboardPanelHtml } from "./skipprDashboardPanelHtml";
import { pipelineName, runSkipprJson } from "./skipprRunner";

export const SKIPPR_DASHBOARDS_VIEW_ID = "skippr.dashboards";
export const SKIPPR_DASHBOARDS_CONTAINER_ID = "skippr.dashboards.activity";
export const SKIPPR_BUSINESS_DASHBOARD_PANEL_TYPE = "skippr.businessDashboard";
export const EXPERIENCE_MODE_KEY = "skippr.experienceMode";
export const BUSINESS_LIGHT_THEME_KEY = "skippr.businessUser.forceLightTheme";
export const SAVED_COLOR_THEME_KEY = "skippr.businessUser.savedColorTheme";
export const DASHBOARD_FILTERS_STATE_KEY = "skippr.dashboardFilters";
export const SKIPPR_AGENT_HOST_SESSION_TYPE = "agent-host-skippr";

const DASHBOARD_API_VERSION = "skippr.dev/dashboard/v1";

export type ExperienceMode = "business" | "engineer";

export interface DashboardListEntry {
  id: string;
  title: string;
  pipeline: string;
  published: boolean;
  path: string;
}

export interface DashboardYamlSpec {
  api_version: string;
  id: string;
  title: string;
  pipeline: string;
  published: boolean;
  layout?: { columns?: number };
  filters: Array<{
    id: string;
    label: string;
    type: string;
    default?: unknown;
    bindings?: Array<{ param: string; column: string }>;
    options_query?: string;
  }>;
  widgets: Array<{
    id: string;
    title: string;
    layout?: { x?: number; y?: number; w?: number; h?: number };
    dataset: { kind: string; ref: string };
    chart?: { type: string; x: string; y: string[] };
    filters?: string[];
  }>;
}

function dashboardsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".skippr", "dashboards");
}

function dashboardFilePath(workspaceRoot: string, id: string): string {
  return path.join(dashboardsDir(workspaceRoot), `${id}.yaml`);
}

function readDashboardYamlMeta(filePath: string): DashboardYamlSpec | undefined {
  try {
    const lines = fs.readFileSync(filePath, "utf8");
    const idMatch = /^id:\s*(.+)$/m.exec(lines);
    const titleMatch = /^title:\s*(.+)$/m.exec(lines);
    const pipelineMatch = /^pipeline:\s*(.+)$/m.exec(lines);
    const publishedMatch = /^published:\s*(true|false)/m.exec(lines);
    if (!idMatch || !titleMatch || !pipelineMatch) {
      return undefined;
    }
    return {
      api_version: DASHBOARD_API_VERSION,
      id: idMatch[1].trim(),
      title: titleMatch[1].trim(),
      pipeline: pipelineMatch[1].trim(),
      published: publishedMatch ? publishedMatch[1] === "true" : false,
      filters: [],
      widgets: []
    };
  } catch {
    return undefined;
  }
}

function writeDashboardYaml(filePath: string, spec: DashboardYamlSpec): void {
  const lines = [
    `apiVersion: ${spec.api_version}`,
    `id: ${spec.id}`,
    `title: ${spec.title}`,
    `pipeline: ${spec.pipeline}`,
    `published: ${spec.published}`,
    "layout:",
    `  columns: ${spec.layout?.columns ?? 12}`,
    "filters: []",
    "widgets: []",
    ""
  ];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

export async function listDashboardsFromDisk(workspaceRoot: string, publishedOnly: boolean): Promise<DashboardListEntry[]> {
  const dir = dashboardsDir(workspaceRoot);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries: DashboardListEntry[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) {
      continue;
    }
    const filePath = path.join(dir, name);
    const spec = readDashboardYamlMeta(filePath);
    if (!spec) {
      continue;
    }
    if (publishedOnly && !spec.published) {
      continue;
    }
    entries.push({
      id: spec.id,
      title: spec.title,
      pipeline: spec.pipeline,
      published: spec.published,
      path: filePath
    });
  }
  entries.sort((a, b) => a.title.localeCompare(b.title));
  return entries;
}

export async function runDashboardCli<T>(
  cliPath: string,
  configPath: string,
  cwd: string,
  output: vscode.LogOutputChannel,
  args: string[]
): Promise<T | undefined> {
  const result = await runSkipprJson<T>(cliPath, args, cwd, output, process.env, configPath);
  if (result.code !== 0) {
    return undefined;
  }
  return result.value;
}

class DashboardTreeItem extends vscode.TreeItem {
  constructor(public readonly entry: DashboardListEntry) {
    super(entry.title, vscode.TreeItemCollapsibleState.None);
    this.description = entry.published ? "published" : "draft";
    this.command = {
      command: "skippr.dashboard.open",
      title: "Open Dashboard",
      arguments: [entry.id]
    };
    this.contextValue = entry.published ? "skipprDashboardPublished" : "skipprDashboardDraft";
  }
}

class DashboardTreeProvider implements vscode.TreeDataProvider<DashboardTreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly getWorkspaceRoot: () => string | undefined) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: DashboardTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<DashboardTreeItem[]> {
    const root = this.getWorkspaceRoot();
    if (!root) {
      return [];
    }
    const entries = await listDashboardsFromDisk(root, false);
    return entries.map((e) => new DashboardTreeItem(e));
  }
}

let businessDashboardPanel: vscode.WebviewPanel | undefined;
let engineerDashboardPanel: vscode.WebviewPanel | undefined;

export function getExperienceMode(context: vscode.ExtensionContext): ExperienceMode {
  return context.globalState.get<ExperienceMode>(EXPERIENCE_MODE_KEY, "engineer");
}

export async function setExperienceMode(context: vscode.ExtensionContext, mode: ExperienceMode): Promise<void> {
  await context.globalState.update(EXPERIENCE_MODE_KEY, mode);
  await vscode.commands.executeCommand("setContext", "skippr.experienceMode", mode);
}

export async function applyBusinessLightTheme(context: vscode.ExtensionContext, force: boolean): Promise<void> {
  if (!force) {
    return;
  }
  const config = vscode.workspace.getConfiguration();
  const current = config.get<string>("workbench.colorTheme");
  const saved = context.globalState.get<string>(SAVED_COLOR_THEME_KEY);
  if (!saved && current) {
    await context.globalState.update(SAVED_COLOR_THEME_KEY, current);
  }
  await config.update("workbench.colorTheme", "Default Light Modern", vscode.ConfigurationTarget.Global);
}

export async function restoreSavedColorTheme(context: vscode.ExtensionContext): Promise<void> {
  const saved = context.globalState.get<string>(SAVED_COLOR_THEME_KEY);
  if (saved) {
    await vscode.workspace.getConfiguration().update("workbench.colorTheme", saved, vscode.ConfigurationTarget.Global);
    await context.globalState.update(SAVED_COLOR_THEME_KEY, undefined);
  }
}

function loadPersistedFilters(context: vscode.ExtensionContext, dashboardId: string): Record<string, unknown> {
  const all = context.workspaceState.get<Record<string, Record<string, unknown>>>(DASHBOARD_FILTERS_STATE_KEY, {});
  return all[dashboardId] ?? {};
}

async function savePersistedFilters(
  context: vscode.ExtensionContext,
  dashboardId: string,
  filters: Record<string, unknown>
): Promise<void> {
  const all = context.workspaceState.get<Record<string, Record<string, unknown>>>(DASHBOARD_FILTERS_STATE_KEY, {});
  all[dashboardId] = filters;
  await context.workspaceState.update(DASHBOARD_FILTERS_STATE_KEY, all);
}

type DashboardRenderResponse = {
  ok: boolean;
  id: string;
  title: string;
  pipeline: string;
  filters?: Array<{ id: string; label: string; type: string; default?: unknown }>;
  widgets: Array<{
    id: string;
    title: string;
    error?: string;
    data?: { header: string[]; rows: string[][] };
    chart?: { type: string; x: string; y: string[] };
  }>;
};

async function renderDashboardInWebview(
  webview: vscode.Webview,
  context: vscode.ExtensionContext,
  cliPath: string,
  configPath: string,
  cwd: string,
  output: vscode.LogOutputChannel,
  dashboardId: string,
  filterValues: Record<string, unknown>
): Promise<void> {
  const filtersJson = JSON.stringify(filterValues);
  const render = await runDashboardCli<DashboardRenderResponse>(cliPath, configPath, cwd, output, [
    "dashboard",
    "render",
    dashboardId,
    "--filters",
    filtersJson,
    "--output",
    "json"
  ]);
  if (!render) {
    webview.postMessage({ type: "dashboardState", dashboard: null, render: null, filterValues });
    return;
  }
  webview.postMessage({
    type: "dashboardState",
    dashboard: {
      id: render.id,
      title: render.title,
      pipeline: render.pipeline,
      filters: render.filters ?? [],
      widgets: []
    },
    render,
    filterValues
  });
}

export async function openBusinessDashboardPanel(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
  resolveCli: () => Promise<string | undefined>,
  resolveConfig: () => Promise<string | undefined>
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage("Open a workspace to view dashboards.");
    return;
  }

  if (businessDashboardPanel) {
    businessDashboardPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  const forceLight = vscode.workspace.getConfiguration().get<boolean>(BUSINESS_LIGHT_THEME_KEY, true);
  const panel = vscode.window.createWebviewPanel(
    SKIPPR_BUSINESS_DASHBOARD_PANEL_TYPE,
    "Insights",
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  businessDashboardPanel = panel;
  panel.webview.html = renderDashboardPanelHtml("business", forceLight);

  const refreshList = async () => {
    const published = await listDashboardsFromDisk(workspaceRoot, true);
    panel.webview.postMessage({ type: "dashboardList", dashboards: published });
    const first = published[0];
    if (first) {
      const cliPath = await resolveCli();
      const configPath = await resolveConfig();
      if (cliPath && configPath) {
        const filters = loadPersistedFilters(context, first.id);
        await renderDashboardInWebview(panel.webview, context, cliPath, configPath, workspaceRoot, output, first.id, filters);
      }
    }
  };

  panel.webview.onDidReceiveMessage(async (msg: { command?: string; id?: string; filters?: Record<string, unknown> }) => {
    const cliPath = await resolveCli();
    const configPath = await resolveConfig();
    if (!cliPath || !configPath) {
      return;
    }
    if (msg.command === "ready" || msg.command === "refresh") {
      await refreshList();
      return;
    }
    if ((msg.command === "select" || msg.command === "render") && msg.id) {
      if (msg.filters) {
        await savePersistedFilters(context, msg.id, msg.filters);
      }
      panel.webview.postMessage({ type: "dashboardLoading" });
      const filters = msg.filters ?? loadPersistedFilters(context, msg.id);
      await renderDashboardInWebview(panel.webview, context, cliPath, configPath, workspaceRoot, output, msg.id, filters);
      return;
    }
    if (msg.command === "askAbout" && msg.id) {
      const meta = readDashboardYamlMeta(dashboardFilePath(workspaceRoot, msg.id));
      const prompt =
        `I am viewing the "${meta?.title ?? msg.id}" dashboard. ` +
        `Active filters: ${JSON.stringify(msg.filters ?? {})}. Answer using warehouse data and vector search.`;
      await vscode.commands.executeCommand(`workbench.action.chat.openNewSessionSidebar.${SKIPPR_AGENT_HOST_SESSION_TYPE}`, {
        prompt,
        initialSessionOptions: { mode: "ask", pipeline: meta?.pipeline }
      });
    }
  });

  panel.onDidDispose(() => {
    businessDashboardPanel = undefined;
  });

  await refreshList();
}

export function registerDashboardContributions(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
  resolveCli: () => Promise<string | undefined>,
  resolveConfig: () => Promise<string | undefined>
): void {
  const getRoot = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const tree = new DashboardTreeProvider(getRoot);
  void vscode.commands.executeCommand("setContext", "skippr.experienceMode", getExperienceMode(context));

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(SKIPPR_DASHBOARDS_VIEW_ID, tree),
    vscode.workspace.createFileSystemWatcher("**/.skippr/dashboards/**").onDidChange(() => tree.refresh()),
    vscode.workspace.createFileSystemWatcher("**/.skippr/dashboards/**").onDidCreate(() => tree.refresh()),
    vscode.workspace.createFileSystemWatcher("**/.skippr/dashboards/**").onDidDelete(() => tree.refresh())
  );

  const openEditorPanel = (id: string) => {
    const root = getRoot();
    if (!root) {
      return;
    }
    const filePath = dashboardFilePath(root, id);
    if (fs.existsSync(filePath)) {
      void vscode.window.showTextDocument(vscode.Uri.file(filePath));
    }
    if (!engineerDashboardPanel) {
      engineerDashboardPanel = vscode.window.createWebviewPanel(
        "skippr.dashboardEditor",
        "Dashboard preview",
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      engineerDashboardPanel.onDidDispose(() => {
        engineerDashboardPanel = undefined;
      });
      engineerDashboardPanel.webview.html = renderDashboardPanelHtml("engineer", false);
      engineerDashboardPanel.webview.onDidReceiveMessage(async (msg) => {
        const cliPath = await resolveCli();
        const configPath = await resolveConfig();
        if (!cliPath || !configPath || !root || !msg.command) {
          return;
        }
        if (msg.command === "ready" || msg.command === "refresh") {
          const entries = await listDashboardsFromDisk(root, false);
          engineerDashboardPanel?.webview.postMessage({ type: "dashboardList", dashboards: entries });
          if (msg.id || id) {
            const dashId = String(msg.id || id);
            await renderDashboardInWebview(
              engineerDashboardPanel!.webview,
              context,
              cliPath,
              configPath,
              root,
              output,
              dashId,
              loadPersistedFilters(context, dashId)
            );
          }
          return;
        }
        if (msg.command === "suggestFilters" && msg.id) {
          const suggested = await runDashboardCli<{ suggested_filters?: unknown[] }>(cliPath, configPath, root, output, [
            "dashboard",
            "suggest-filters",
            String(msg.id),
            "--output",
            "json"
          ]);
          const count = suggested?.suggested_filters?.length ?? 0;
          if (count > 0) {
            vscode.window.showInformationMessage(`Suggested ${count} filter(s). Review and merge into the dashboard YAML.`);
          }
          return;
        }
        if (msg.command === "togglePublished" && msg.id) {
          const fp = dashboardFilePath(root, String(msg.id));
          const spec = readDashboardYamlMeta(fp);
          if (spec) {
            spec.published = !spec.published;
            writeDashboardYaml(fp, spec);
            tree.refresh();
          }
          return;
        }
        if (msg.command === "addFromEditor") {
          void vscode.commands.executeCommand("skippr.dashboard.addFromEditor", msg.id);
          return;
        }
        if (msg.command === "newDashboard") {
          void vscode.commands.executeCommand("skippr.dashboard.create");
        }
        if (msg.command === "render" && msg.id) {
          await renderDashboardInWebview(
            engineerDashboardPanel!.webview,
            context,
            cliPath,
            configPath,
            root,
            output,
            String(msg.id),
            msg.filters ?? {}
          );
        }
      });
    }
    engineerDashboardPanel.reveal();
    engineerDashboardPanel.webview.postMessage({ type: "dashboardList", command: "refresh", id });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("skippr.dashboard.open", (dashId?: string) => {
      if (!dashId) {
        return;
      }
      openEditorPanel(String(dashId));
    }),
    vscode.commands.registerCommand("skippr.dashboard.openBusinessView", async () => {
      await openBusinessDashboardPanel(context, output, resolveCli, resolveConfig);
    }),
    vscode.commands.registerCommand("skippr.dashboard.create", async () => {
      const root = getRoot();
      if (!root) {
        return;
      }
      const newId = await vscode.window.showInputBox({ prompt: "Dashboard id (filename)", placeHolder: "revenue_overview" });
      if (!newId?.trim()) {
        return;
      }
      const title = (await vscode.window.showInputBox({ prompt: "Dashboard title", value: newId })) ?? newId;
      const pipeline =
        (await vscode.window.showInputBox({ prompt: "Pipeline name", placeHolder: "bike_hire" })) ?? "bike_hire";
      const filePath = dashboardFilePath(root, newId.trim());
      if (fs.existsSync(filePath)) {
        vscode.window.showWarningMessage(`Dashboard ${newId} already exists.`);
        return;
      }
      writeDashboardYaml(filePath, {
        api_version: DASHBOARD_API_VERSION,
        id: newId.trim(),
        title,
        pipeline,
        published: false,
        filters: [],
        widgets: []
      });
      tree.refresh();
      openEditorPanel(newId.trim());
    }),
    vscode.commands.registerCommand("skippr.dashboard.addFromTable", async () => {
      const root = getRoot();
      if (!root) {
        return;
      }
      const table = await vscode.window.showInputBox({ prompt: "Table name (schema.table or table)" });
      const dashId = await vscode.window.showInputBox({ prompt: "Dashboard id to add widget to" });
      if (!table?.trim() || !dashId?.trim()) {
        return;
      }
      appendWidgetYaml(root, dashId.trim(), table.trim(), "table", table.trim());
      tree.refresh();
      openEditorPanel(dashId.trim());
    }),
    vscode.commands.registerCommand("skippr.dashboard.addFromEditor", async (dashId?: string) => {
      const editor = vscode.window.activeTextEditor;
      const root = getRoot();
      if (!editor || !root) {
        vscode.window.showWarningMessage("Open a SQL or dbt file in a workspace first.");
        return;
      }
      const rel = path.relative(root, editor.document.uri.fsPath).replace(/\\/g, "/");
      const isDbt = rel.includes("/dbt/") || rel.startsWith("models/");
      const kind = isDbt ? "dbt" : "sql";
      const targetDash =
        typeof dashId === "string" && dashId.trim()
          ? dashId.trim()
          : (await vscode.window.showInputBox({ prompt: "Dashboard id" }))?.trim();
      if (!targetDash) {
        return;
      }
      appendWidgetYaml(root, targetDash, path.basename(rel), kind, rel);
      tree.refresh();
      openEditorPanel(targetDash);
    }),
    vscode.commands.registerCommand("skippr.dashboard.modelForDashboard", async () => {
      const goal = await vscode.window.showInputBox({
        prompt: "Modeling goal for dashboard backing data",
        placeHolder: "Create a mart for daily revenue by region"
      });
      if (!goal) {
        return;
      }
      const pipelineRaw = await vscode.window.showInputBox({ prompt: "Pipeline" });
      const p = pipelineRaw ? pipelineName(pipelineRaw) : undefined;
      if (!p) {
        return;
      }
      await vscode.commands.executeCommand(`workbench.action.chat.openNewSessionSidebar.${SKIPPR_AGENT_HOST_SESSION_TYPE}`, {
        prompt: `Extend dbt models for a dashboard: ${goal}. Pipeline: ${p}.`,
        initialSessionOptions: { mode: "agent", pipeline: p }
      });
    })
  );
}

function appendWidgetYaml(root: string, dashId: string, title: string, kind: string, ref: string): void {
  const filePath = dashboardFilePath(root, dashId);
  if (!fs.existsSync(filePath)) {
    vscode.window.showWarningMessage("Create the dashboard first.");
    return;
  }
  let raw = fs.readFileSync(filePath, "utf8");
  const widgetId = title.replace(/\W+/g, "_").toLowerCase();
  const block = [
    `  - id: ${widgetId}`,
    `    title: ${title}`,
    `    layout: { x: 0, y: 0, w: 6, h: 4 }`,
    `    dataset:`,
    `      kind: ${kind}`,
    `      ref: ${ref}`,
    ""
  ].join("\n");
  if (raw.includes("widgets: []")) {
    raw = raw.replace("widgets: []", `widgets:\n${block}`);
  } else {
    raw += `\n${block}`;
  }
  fs.writeFileSync(filePath, raw, "utf8");
}
