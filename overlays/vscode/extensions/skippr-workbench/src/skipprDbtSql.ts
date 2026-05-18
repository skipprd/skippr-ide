import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { runSkipprJson } from "./skipprRunner";

export const SKIPPR_EDITOR_IS_DBT_SQL = "skippr.editorIsDbtSql";
export const SKIPPR_EDITOR_RUN_HAS_DBT_TESTS = "skippr.editorRunHasDbtTests";
export const SKIPPR_EDITOR_DBT_RUN_MODE = "skippr.editorDbtRunMode";

export type DbtEditorRunMode = "sql" | "tests";

const DBT_SQL_RESOURCE_PREFIXES = ["models/", "snapshots/", "analyses/"];

export interface DbtSqlFileContext {
  isDbt: boolean;
  filePath: string;
  dbtRoot?: string;
  relPath?: string;
}

export interface SkipprDbtCompileSqlResult {
  ok?: boolean;
  pipeline?: string;
  rel_path?: string;
  model_name?: string;
  test_select?: string;
  has_tests?: boolean;
  compiled_sql?: string;
  error?: string;
}

export function detectDbtSqlFile(uri: vscode.Uri): DbtSqlFileContext {
  const filePath = uri.fsPath;
  if (!filePath.toLowerCase().endsWith(".sql")) {
    return { isDbt: false, filePath };
  }
  let dir = path.dirname(filePath);
  const root = path.parse(filePath).root;
  while (true) {
    const projectYml = path.join(dir, "dbt_project.yml");
    if (fs.existsSync(projectYml)) {
      const relPath = path.relative(dir, filePath).split(path.sep).join("/");
      const isResource = DBT_SQL_RESOURCE_PREFIXES.some((prefix) => relPath.startsWith(prefix));
      if (!isResource) {
        return { isDbt: false, filePath };
      }
      return { isDbt: true, filePath, dbtRoot: dir, relPath };
    }
    if (dir === root) {
      break;
    }
    dir = path.dirname(dir);
  }
  return { isDbt: false, filePath };
}

export async function probeDbtFileMeta(
  cliPath: string,
  configPath: string,
  pipeline: string,
  filePath: string,
  cwd: string,
  output: vscode.LogOutputChannel,
  env: NodeJS.ProcessEnv,
  parseOnly: boolean
): Promise<SkipprDbtCompileSqlResult | undefined> {
  const args = [
    "--config",
    configPath,
    "dbt",
    "compile-sql",
    "--pipeline",
    pipeline,
    "--file",
    filePath,
    "--output",
    "json"
  ];
  if (parseOnly) {
    args.push("--parse-only");
  }
  const result = await runSkipprJson<SkipprDbtCompileSqlResult>(cliPath, args, cwd, output, env, configPath);
  return result.value;
}

export async function probeDbtFileHasTests(
  cliPath: string,
  configPath: string,
  pipeline: string,
  filePath: string,
  cwd: string,
  output: vscode.LogOutputChannel,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  const payload = await probeDbtFileMeta(cliPath, configPath, pipeline, filePath, cwd, output, env, true);
  return payload?.has_tests === true;
}

export async function compileDbtSqlForQuery(
  cliPath: string,
  configPath: string,
  pipeline: string,
  filePath: string,
  cwd: string,
  output: vscode.LogOutputChannel,
  env: NodeJS.ProcessEnv
): Promise<{ ok: true; sql: string; meta: SkipprDbtCompileSqlResult } | { ok: false; error: string }> {
  const result = await runSkipprJson<SkipprDbtCompileSqlResult>(
    cliPath,
    [
      "--config",
      configPath,
      "dbt",
      "compile-sql",
      "--pipeline",
      pipeline,
      "--file",
      filePath,
      "--output",
      "json"
    ],
    cwd,
    output,
    env,
    configPath
  );
  const payload = result.value;
  if (result.code !== 0 || !payload?.ok || !payload.compiled_sql?.trim()) {
    const detail =
      payload?.error?.trim() ||
      result.stdout?.trim() ||
      "dbt compile-sql did not return compiled SQL.";
    return { ok: false, error: detail };
  }
  return { ok: true, sql: payload.compiled_sql.trim(), meta: payload };
}

export async function refreshDbtEditorContextKeys(
  editor: vscode.TextEditor | undefined,
  opts: {
    getRunMode: () => DbtEditorRunMode;
    probeHasTests?: (filePath: string) => Promise<boolean>;
  }
): Promise<void> {
  if (!editor || editor.document.languageId !== "sql") {
    await vscode.commands.executeCommand("setContext", SKIPPR_EDITOR_IS_DBT_SQL, false);
    await vscode.commands.executeCommand("setContext", SKIPPR_EDITOR_RUN_HAS_DBT_TESTS, false);
    return;
  }
  const detected = detectDbtSqlFile(editor.document.uri);
  if (!detected.isDbt) {
    await vscode.commands.executeCommand("setContext", SKIPPR_EDITOR_IS_DBT_SQL, false);
    await vscode.commands.executeCommand("setContext", SKIPPR_EDITOR_RUN_HAS_DBT_TESTS, false);
    return;
  }
  await vscode.commands.executeCommand("setContext", SKIPPR_EDITOR_IS_DBT_SQL, true);
  let hasTests = false;
  if (opts.probeHasTests) {
    try {
      hasTests = await opts.probeHasTests(detected.filePath);
    } catch {
      hasTests = false;
    }
  }
  await vscode.commands.executeCommand("setContext", SKIPPR_EDITOR_RUN_HAS_DBT_TESTS, hasTests);
  await vscode.commands.executeCommand("setContext", SKIPPR_EDITOR_DBT_RUN_MODE, opts.getRunMode());
}

export function dbtRunModeMenuTitle(mode: DbtEditorRunMode): string {
  return mode === "tests" ? "Tests" : "SQL";
}
