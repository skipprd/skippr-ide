import * as path from "node:path";
import { spawn } from "node:child_process";
import * as vscode from "vscode";
import { isSkipprConfigDocument, listPipelineDefinitionLines } from "./skipprPipelineCodeLens";
import { effectiveEnvForSkipprConfig } from "./skipprDotEnv";
import { mergeSkipprSpawnEnv, workspaceFolderForConfigPath } from "./skipprEnv";
import { buildCliCommand, cliCommandCwd, formatCliCommand } from "./skipprRunner";
import type { SkipprDoctorResult } from "./types";

const INTERP_REGEX = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const DOCTOR_DEBOUNCE_MS = 1600;
const doctorTimers = new Map<string, ReturnType<typeof setTimeout>>();
const doctorCache = new Map<string, { checks: SkipprDoctorResult["checks"] }>();

function isVarResolved(
  name: string,
  processEnv: NodeJS.ProcessEnv,
  folder: vscode.Uri | undefined,
  pipelinesInFile: string[]
): boolean {
  if (Object.prototype.hasOwnProperty.call(processEnv, name) && processEnv[name] !== undefined && processEnv[name] !== "") {
    return true;
  }
  const merged = mergeSkipprSpawnEnv({}, folder, undefined);
  if (merged[name]) {
    return true;
  }
  for (const p of pipelinesInFile) {
    const m = mergeSkipprSpawnEnv({}, folder, p);
    if (m[name]) {
      return true;
    }
  }
  return false;
}

export function scanUnresolvedInterpolationDiagnostics(
  text: string,
  folder: vscode.Uri | undefined,
  processEnv: NodeJS.ProcessEnv
): vscode.Diagnostic[] {
  const pipelinesInFile = listPipelineDefinitionLines(text).map((d) => d.name);
  const lines = text.split(/\r?\n/);
  const diags: vscode.Diagnostic[] = [];
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx];
    if (/^\s*#/.test(line)) {
      continue;
    }
    INTERP_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INTERP_REGEX.exec(line)) !== null) {
      const varName = m[1];
      if (isVarResolved(varName, processEnv, folder, pipelinesInFile)) {
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      const range = new vscode.Range(lineIdx, start, lineIdx, end);
      diags.push(
        new vscode.Diagnostic(
          range,
          `Environment variable "${varName}" is not set (process env, .env next to skippr.yml, skippr.env, or skippr.pipelineEnv for a pipeline in this file).`,
          vscode.DiagnosticSeverity.Warning
        )
      );
    }
  }
  return diags;
}

function doctorDiagnosticsForChecks(checks: SkipprDoctorResult["checks"] | undefined): vscode.Diagnostic[] {
  const failed = checks?.filter((c) => !c.ok) ?? [];
  const firstLine = new vscode.Range(0, 0, 0, 1);
  return failed.map(
    (c) =>
      new vscode.Diagnostic(
        firstLine,
        `Skippr doctor: ${c.message}`,
        vscode.DiagnosticSeverity.Warning
      )
  );
}

function runDoctorJson(
  cliPath: string,
  configPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<{ code: number | null; json?: SkipprDoctorResult }> {
  const args = ["--config", configPath, "--log", "error", "doctor", "--output", "json"];
  const [command, ...commandArgs] = buildCliCommand(cliPath, args);
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: cliCommandCwd(cliPath) ?? cwd, env, shell: false });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", () => {
      /* stderr ignored for diagnostics */
    });
    child.on("close", (code) => {
      let json: SkipprDoctorResult | undefined;
      try {
        json = JSON.parse(stdout.trim()) as SkipprDoctorResult;
      } catch {
        // ignore
      }
      resolve({ code, json });
    });
    child.on("error", () => {
      resolve({ code: 1, json: undefined });
    });
  });
}

export interface SkipprDiagnosticsHost {
  resolveCliPath: () => Promise<string | undefined>;
  output: vscode.LogOutputChannel;
}

export function registerSkipprConfigDiagnostics(context: vscode.ExtensionContext, host: SkipprDiagnosticsHost): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection("skippr");
  const folderOf = (doc: vscode.TextDocument) => vscode.workspace.getWorkspaceFolder(doc.uri)?.uri;

  const applyDoctorLater = (configPath: string): void => {
    const key = configPath;
    const existing = doctorTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    doctorTimers.set(
      key,
      setTimeout(() => {
        doctorTimers.delete(key);
        void (async () => {
          const cliPath = await host.resolveCliPath();
          if (!cliPath) {
            return;
          }
          const folder = workspaceFolderForConfigPath(configPath);
          const cwd = configPath ? path.dirname(configPath) : folder?.fsPath ?? "";
          const env = mergeSkipprSpawnEnv(effectiveEnvForSkipprConfig(configPath, process.env), folder, undefined);
          const { code, json } = await runDoctorJson(cliPath, configPath, cwd, env);
          if (code !== 0 || !json?.checks) {
            return;
          }
          doctorCache.set(key, { checks: json.checks });
          const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === configPath && isSkipprConfigDocument(d));
          if (!open) {
            return;
          }
          refreshDocument(open, false);
        })();
      }, DOCTOR_DEBOUNCE_MS)
    );
  };

  function refreshDocument(doc: vscode.TextDocument, scheduleDoctor: boolean): void {
    if (!isSkipprConfigDocument(doc)) {
      return;
    }
    const folder = folderOf(doc);
    const env = effectiveEnvForSkipprConfig(doc.uri.fsPath, process.env);
    const interp = scanUnresolvedInterpolationDiagnostics(doc.getText(), folder, env);
    const cached = doctorCache.get(doc.uri.fsPath);
    const fromDoctor = cached ? doctorDiagnosticsForChecks(cached.checks) : [];
    collection.set(doc.uri, [...interp, ...fromDoctor]);
    if (scheduleDoctor) {
      applyDoctorLater(doc.uri.fsPath);
    }
  }

  for (const doc of vscode.workspace.textDocuments) {
    refreshDocument(doc, true);
  }

  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument((d) => refreshDocument(d, true)),
    vscode.workspace.onDidChangeTextDocument((e) => refreshDocument(e.document, true)),
    vscode.workspace.onDidCloseTextDocument((d) => {
      if (isSkipprConfigDocument(d)) {
        collection.delete(d.uri);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("skippr.env") || e.affectsConfiguration("skippr.pipelineEnv")) {
        for (const doc of vscode.workspace.textDocuments) {
          refreshDocument(doc, false);
        }
      }
    }),
    vscode.workspace.onDidSaveTextDocument((d) => {
      const base = path.basename(d.uri.fsPath);
      if (base !== ".env" && base !== ".env.local") {
        return;
      }
      const dir = path.dirname(d.uri.fsPath);
      for (const doc of vscode.workspace.textDocuments) {
        if (isSkipprConfigDocument(doc) && path.dirname(doc.uri.fsPath) === dir) {
          refreshDocument(doc, false);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("skippr.refreshDiagnostics", async () => {
      const editor = vscode.window.activeTextEditor;
      const doc = editor?.document;
      if (doc && isSkipprConfigDocument(doc)) {
        doctorCache.delete(doc.uri.fsPath);
        refreshDocument(doc, true);
        const cliPath = await host.resolveCliPath();
        if (!cliPath) {
          vscode.window.showWarningMessage("Skippr CLI not found; interpolation diagnostics refreshed, doctor skipped.");
          return;
        }
        const folder = folderOf(doc);
        const cwd = path.dirname(doc.uri.fsPath);
        const env = mergeSkipprSpawnEnv(effectiveEnvForSkipprConfig(doc.uri.fsPath, process.env), folder, undefined);
        host.output.info(`$ ${formatCliCommand(cliPath, ["--config", doc.uri.fsPath, "doctor", "--output", "json"])}`);
        const { code, json } = await runDoctorJson(cliPath, doc.uri.fsPath, cwd, env);
        if (code === 0 && json?.checks) {
          doctorCache.set(doc.uri.fsPath, { checks: json.checks });
        }
        refreshDocument(doc, false);
        vscode.window.showInformationMessage("Skippr diagnostics refreshed.");
        return;
      }
      for (const d of vscode.workspace.textDocuments) {
        if (isSkipprConfigDocument(d)) {
          doctorCache.delete(d.uri.fsPath);
          refreshDocument(d, true);
        }
      }
      vscode.window.showInformationMessage("Skippr diagnostics refresh scheduled for open config files.");
    })
  );

  return collection;
}
