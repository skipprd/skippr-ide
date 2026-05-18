import { existsSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

/** Workspace-folder keys merged into every Skippr CLI spawn (after `process.env`). */
export const SKIPPR_ENV_SETTING = "env";
/** Map of pipeline name → env vars merged after `skippr.env` when that pipeline is active. */
export const SKIPPR_PIPELINE_ENV_SETTING = "pipelineEnv";
/** Optional path to the Python virtualenv Skippr should use for dbt. */
export const SKIPPR_DBT_VENV_SETTING = "dbtVirtualEnvPath";

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof k === "string" && typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
}

function asPipelineEnvMap(value: unknown): Record<string, Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, Record<string, string>> = {};
  for (const [pipeline, envVal] of Object.entries(value as Record<string, unknown>)) {
    if (typeof pipeline !== "string" || !pipeline.trim()) {
      continue;
    }
    out[pipeline.trim()] = asStringRecord(envVal);
  }
  return out;
}

export function workspaceFolderForConfigPath(configFsPath: string | undefined): vscode.Uri | undefined {
  if (!configFsPath?.trim()) {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }
  return vscode.workspace.getWorkspaceFolder(vscode.Uri.file(configFsPath))?.uri;
}

/**
 * Build `process.env` for Skippr spawns: `process.env`, then `skippr.env`, then `skippr.pipelineEnv[pipeline]`.
 * The Skippr CLI separately loads `.env` / `.env.local` beside `skippr.yml` before resolving `${VAR}` in the manifest.
 */
export function mergeSkipprSpawnEnv(
  base: NodeJS.ProcessEnv,
  workspaceFolder: vscode.Uri | undefined,
  pipeline: string | undefined,
  configPath?: string
): NodeJS.ProcessEnv {
  const conf = vscode.workspace.getConfiguration("skippr", workspaceFolder);
  const globalExtra = asStringRecord(conf.get(SKIPPR_ENV_SETTING));
  const pipeMap = asPipelineEnvMap(conf.get(SKIPPR_PIPELINE_ENV_SETTING));
  const trimmed = pipeline?.trim();
  const pipeExtra = trimmed ? pipeMap[trimmed] : undefined;
  return withDbtVirtualEnv({ ...base, ...globalExtra, ...(pipeExtra ?? {}) }, conf, workspaceFolder, configPath);
}

function withDbtVirtualEnv(
  env: NodeJS.ProcessEnv,
  conf: vscode.WorkspaceConfiguration,
  workspaceFolder: vscode.Uri | undefined,
  configPath: string | undefined
): NodeJS.ProcessEnv {
  if (env.DBT_BIN?.trim()) {
    return env;
  }
  const venvRoot = resolveDbtVirtualEnv(conf, workspaceFolder, configPath, env);
  if (!venvRoot) {
    return env;
  }
  const binDir = venvBinDir(venvRoot);
  const dbtBin = path.join(binDir, process.platform === "win32" ? "dbt.exe" : "dbt");
  return {
    ...env,
    DBT_BIN: dbtBin,
    VIRTUAL_ENV: env.VIRTUAL_ENV?.trim() || venvRoot,
    PATH: prependPath(binDir, env.PATH)
  };
}

function resolveDbtVirtualEnv(
  conf: vscode.WorkspaceConfiguration,
  workspaceFolder: vscode.Uri | undefined,
  configPath: string | undefined,
  env: NodeJS.ProcessEnv
): string | undefined {
  const configured = conf.get<string>(SKIPPR_DBT_VENV_SETTING, "").trim() || env.SKIPPR_DBT_VIRTUAL_ENV?.trim();
  if (configured) {
    const root = resolveMaybeRelative(configured, workspaceFolder);
    if (dbtBinExists(root)) {
      return root;
    }
  }
  if (env.VIRTUAL_ENV?.trim() && dbtBinExists(env.VIRTUAL_ENV.trim())) {
    return env.VIRTUAL_ENV.trim();
  }

  for (const root of candidateVenvRoots(workspaceFolder, configPath)) {
    if (dbtBinExists(root)) {
      return root;
    }
  }
  return undefined;
}

function candidateVenvRoots(workspaceFolder: vscode.Uri | undefined, configPath: string | undefined): string[] {
  const roots = new Set<string>();
  const addRootCandidates = (root: string | undefined) => {
    if (!root) {
      return;
    }
    for (const name of [".venv", "venv"]) {
      roots.add(path.join(root, name));
    }
  };

  addRootCandidates(workspaceFolder?.fsPath);
  addRootCandidates(configPath ? path.dirname(configPath) : undefined);
  for (const root of extensionAncestorRoots()) {
    addRootCandidates(root);
  }
  return [...roots];
}

function extensionAncestorRoots(): string[] {
  const roots: string[] = [];
  let current = __dirname;
  for (let i = 0; i < 8; i++) {
    roots.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return roots;
}

function resolveMaybeRelative(value: string, workspaceFolder: vscode.Uri | undefined): string {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(workspaceFolder?.fsPath ?? process.cwd(), value);
}

function venvBinDir(venvRoot: string): string {
  return path.join(venvRoot, process.platform === "win32" ? "Scripts" : "bin");
}

function dbtBinExists(venvRoot: string): boolean {
  return existsSync(path.join(venvBinDir(venvRoot), process.platform === "win32" ? "dbt.exe" : "dbt"));
}

function prependPath(dir: string, current: string | undefined): string {
  return current?.trim() ? `${dir}${path.delimiter}${current}` : dir;
}
