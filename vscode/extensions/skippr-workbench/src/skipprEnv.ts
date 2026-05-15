import * as vscode from "vscode";

/** Workspace-folder keys merged into every Skippr CLI spawn (after `process.env`). */
export const SKIPPR_ENV_SETTING = "env";
/** Map of pipeline name → env vars merged after `skippr.env` when that pipeline is active. */
export const SKIPPR_PIPELINE_ENV_SETTING = "pipelineEnv";

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
  pipeline: string | undefined
): NodeJS.ProcessEnv {
  const conf = vscode.workspace.getConfiguration("skippr", workspaceFolder);
  const globalExtra = asStringRecord(conf.get(SKIPPR_ENV_SETTING));
  const pipeMap = asPipelineEnvMap(conf.get(SKIPPR_PIPELINE_ENV_SETTING));
  const trimmed = pipeline?.trim();
  const pipeExtra = trimmed ? pipeMap[trimmed] : undefined;
  return { ...base, ...globalExtra, ...(pipeExtra ?? {}) };
}
