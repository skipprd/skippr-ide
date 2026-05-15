import { spawn } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";
import { parseShellArgs } from "./skipprCliArgs";
import { buildCliCommand, cliCommandCwd, formatCliCommand, runSkipprJson } from "./skipprRunner";

export interface SkipprDbtTestDeps {
  output: vscode.LogOutputChannel;
  resolveCliPath: () => Promise<string | undefined>;
  getConfigCwd: (configFsPath: string) => string;
  /** Opens the Skippr output channel so CLI / dbt logs are visible. */
  revealSkipprOutput: () => void;
  /** Process environment for Skippr CLI (merged workspace + per-pipeline settings). */
  getSpawnEnv: (ref: PipelineRef) => NodeJS.ProcessEnv;
  /** Log level for `skippr test run --log` (align with Run Skippr / skippr.logLevel). */
  getLogLevel?: () => string;
  /** Extra CLI args from `skippr.run.extraArgs` (same as title bar). */
  getRunExtraArgsText?: () => string;
}

export interface PipelineRef {
  configFsPath: string;
  pipeline: string;
}

export function parsePipelineParentId(id: string): PipelineRef | undefined {
  try {
    const parsed = JSON.parse(id) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { configFsPath: parsed[0], pipeline: parsed[1] };
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function makeDbtChildTestId(configFsPath: string, pipeline: string, uniqueId: string): string {
  return JSON.stringify([configFsPath, pipeline, "dbt", uniqueId]);
}

export function parseDbtChildTestId(id: string): (PipelineRef & { uniqueId: string }) | undefined {
  try {
    const parsed = JSON.parse(id) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === 4 &&
      parsed[2] === "dbt" &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string" &&
      typeof parsed[3] === "string"
    ) {
      return { configFsPath: parsed[0], pipeline: parsed[1], uniqueId: parsed[3] };
    }
  } catch {
    // ignore
  }
  return undefined;
}

export interface SkipprTestListJson {
  pipeline: string;
  project_root: string;
  tests: Array<{
    unique_id: string;
    name: string;
    resource_type: string;
    path?: string;
    original_file_path?: string;
  }>;
}

function testUri(projectRoot: string, t: SkipprTestListJson["tests"][0]): vscode.Uri | undefined {
  const rel = (t.original_file_path ?? t.path ?? "").trim();
  if (!rel || rel.includes("..")) {
    return undefined;
  }
  const abs = path.join(projectRoot, rel);
  return vscode.Uri.file(abs);
}

const OUTPUT_PANEL_HINT =
  "Open **View → Output**, choose **Skippr** in the dropdown (same panel as Discover / Model).";

function clipText(s: string, maxChars: number): string {
  const t = s.trimEnd();
  if (t.length <= maxChars) {
    return t;
  }
  return `${t.slice(0, maxChars)}\n… (${t.length - maxChars} more characters — see beginning above)`;
}

function logTestRunBanner(deps: SkipprDbtTestDeps, title: string, body: string): void {
  deps.output.error(`\n── ${title} ──\n${body}\n${OUTPUT_PANEL_HINT}\n`);
}

async function offerShowSkipprOutput(message: string, deps: SkipprDbtTestDeps): Promise<void> {
  const choice = await vscode.window.showWarningMessage(message, "Show Skippr output");
  if (choice === "Show Skippr output") {
    deps.revealSkipprOutput();
  }
}

export async function resolveDbtChildrenForPipelineItem(
  controller: vscode.TestController,
  parent: vscode.TestItem,
  ref: PipelineRef,
  deps: SkipprDbtTestDeps
): Promise<void> {
  if (parent.children.size > 0) {
    return;
  }
  const cliPath = await deps.resolveCliPath();
  if (!cliPath) {
    return;
  }
  const cwd = deps.getConfigCwd(ref.configFsPath);
  parent.busy = true;
  try {
    const result = await runSkipprJson<SkipprTestListJson>(
      cliPath,
      ["--config", ref.configFsPath, "test", "list", "--pipeline", ref.pipeline, "--output", "json"],
      cwd,
      deps.output,
      deps.getSpawnEnv(ref)
    );
    const payload = result.value;
    const tests = payload?.tests;
    if (result.code !== 0 || !payload || !Array.isArray(tests)) {
      const detail = clipText(
        [
          `exit code: ${result.code ?? "?"}`,
          result.stdout?.trim() ? `--- stdout ---\n${result.stdout.trim()}` : "(no stdout)",
          `--- parse note ---`,
          !result.value ? "Response was not valid JSON (see stdout above)." : "Unexpected response shape."
        ].join("\n\n"),
        12000
      );
      logTestRunBanner(deps, `skippr test list failed (${ref.pipeline})`, detail);
      deps.revealSkipprOutput();
      await offerShowSkipprOutput(`Skippr could not list dbt tests for pipeline "${ref.pipeline}".`, deps);
      return;
    }
    const root = payload.project_root;
    for (const t of tests) {
      const id = makeDbtChildTestId(ref.configFsPath, ref.pipeline, t.unique_id);
      const label = t.name?.trim() ? `${t.name} (${t.unique_id})` : t.unique_id;
      const uri = testUri(root, t);
      const child = controller.createTestItem(id, label, uri);
      child.description = "dbt";
      parent.children.add(child);
    }
  } finally {
    parent.busy = false;
  }
}

interface JsonlTestResult {
  event?: string;
  unique_id?: string;
  status?: string;
  message?: string;
  stdout?: string;
  stderr?: string;
}

export function runSkipprJsonLines(
  cliPath: string,
  args: string[],
  cwd: string,
  output: vscode.LogOutputChannel,
  token: vscode.CancellationToken,
  spawnEnv: NodeJS.ProcessEnv = process.env
): Promise<{ code: number | null; lines: JsonlTestResult[]; stderr: string; stdout: string }> {
  const [command, ...commandArgs] = buildCliCommand(cliPath, args);
  output.info(`$ ${formatCliCommand(cliPath, args)}`);
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: cliCommandCwd(cliPath) ?? cwd, env: spawnEnv, shell: false });
    let stderr = "";
    let stdout = "";
    let buf = "";
    const lines: JsonlTestResult[] = [];
    const sub = token.onCancellationRequested(() => {
      if (!child.killed) {
        child.kill();
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c: string) => {
      stderr += c;
      output.info(c.trimEnd());
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      buf += chunk;
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (!line) {
          continue;
        }
        try {
          lines.push(JSON.parse(line) as JsonlTestResult);
        } catch {
          output.warn(`[skippr test run] (non-JSON stdout line) ${line}`);
        }
      }
    });
    child.on("close", (code) => {
      sub.dispose();
      const tail = buf.trim();
      if (tail) {
        try {
          lines.push(JSON.parse(tail) as JsonlTestResult);
        } catch {
          if (tail) {
            output.warn(`[skippr test run] (non-JSON stdout tail) ${tail}`);
          }
        }
      }
      resolve({ code, lines, stderr, stdout });
    });
    child.on("error", (err) => {
      sub.dispose();
      output.error(err.message);
      resolve({ code: 1, lines, stderr: stderr + err.message, stdout });
    });
  });
}

function collectTestErrorEvents(rows: JsonlTestResult[]): JsonlTestResult[] {
  return rows.filter((r) => r.event === "test_error");
}

function markdownForRunDiagnostics(
  pipeline: string,
  code: number | null,
  stderr: string,
  stdout: string,
  testErrors: JsonlTestResult[],
  preamble?: string
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  if (preamble?.trim()) {
    md.appendMarkdown(`${preamble.trim()}\n\n`);
  }
  md.appendMarkdown(`**Pipeline:** \`${pipeline}\`  \n`);
  md.appendMarkdown(`**Process exit code:** \`${code ?? "?"}\`  \n\n`);
  md.appendMarkdown(`${OUTPUT_PANEL_HINT}  \n\n`);
  if (testErrors.length > 0) {
    md.appendMarkdown(`### Structured errors (\`test_error\`)\n\n`);
    for (const e of testErrors) {
      md.appendMarkdown(
        `\`\`\`json\n${clipText(JSON.stringify(e, null, 2), 4000)}\n\`\`\`\n\n`
      );
    }
  }
  if (stderr.trim()) {
    md.appendMarkdown(`### stderr (tail)\n\n\`\`\`text\n${clipText(stderr, 8000)}\n\`\`\`\n\n`);
  }
  if (stdout.trim()) {
    md.appendMarkdown(
      `### stdout (tail — includes JSONL events and any dbt text)\n\n\`\`\`text\n${clipText(stdout, 12000)}\n\`\`\`\n`
    );
  }
  return md;
}

export async function runDbtTestsForRequest(
  controller: vscode.TestController,
  request: vscode.TestRunRequest,
  run: vscode.TestRun,
  token: vscode.CancellationToken,
  deps: SkipprDbtTestDeps
): Promise<void> {
  try {
    deps.output.show(true);
    const cliPath = await deps.resolveCliPath();
    if (!cliPath) {
      run.appendOutput("Skippr CLI not found. Install the CLI to run dbt tests.\n");
      vscode.window.showErrorMessage("Skippr CLI not found. Install the CLI to run dbt tests.");
      return;
    }

    const included = dedupeTestItems(collectIncluded(request, controller));
    const byPipeline = new Map<string, { ref: PipelineRef; items: vscode.TestItem[]; selects: Set<string> }>();

    const ensureEntry = (ref: PipelineRef) => {
      const key = ref.configFsPath + "\0" + ref.pipeline;
      let e = byPipeline.get(key);
      if (!e) {
        e = { ref, items: [], selects: new Set() };
        byPipeline.set(key, e);
      }
      return e;
    };

    for (const t of included) {
      const child = parseDbtChildTestId(t.id);
      if (child) {
        const e = ensureEntry({ configFsPath: child.configFsPath, pipeline: child.pipeline });
        e.items.push(t);
        e.selects.add(child.uniqueId);
        continue;
      }
      const parent = parsePipelineParentId(t.id);
      if (parent) {
        const e = ensureEntry(parent);
        e.items.push(t);
      }
    }

    for (const { ref, items, selects } of byPipeline.values()) {
      if (token.isCancellationRequested) {
        break;
      }
      for (const it of items) {
        run.started(it);
      }
      const cwd = deps.getConfigCwd(ref.configFsPath);
      const logLevel = (deps.getLogLevel?.() ?? "info").trim() || "info";
      const args = [
        "--config",
        ref.configFsPath,
        "--log",
        logLevel,
        "test",
        "run",
        "--pipeline",
        ref.pipeline,
        "--output",
        "jsonl"
      ];
      for (const s of selects) {
        if (s.trim()) {
          args.push("--select", s.trim());
        }
      }
      args.push(...parseShellArgs(deps.getRunExtraArgsText?.() ?? ""));
      run.appendOutput(`$ ${formatCliCommand(cliPath, args)}\n`);
      run.appendOutput(`cwd: ${cwd}\n\n`);
      const { code, lines, stderr, stdout } = await runSkipprJsonLines(
        cliPath,
        args,
        cwd,
        deps.output,
        token,
        deps.getSpawnEnv(ref)
      );
      run.appendOutput(`Finished with exit code ${code ?? "?"}. JSONL events: ${lines.length}.\n`);
      const results = new Map<string, JsonlTestResult>();
      for (const row of lines) {
        if (row.event === "test_result" && row.unique_id) {
          results.set(row.unique_id, row);
        }
      }
      const testErrors = collectTestErrorEvents(lines);
      const sawGlobalError = testErrors.length > 0;
      const failed = code !== 0 || sawGlobalError;

      if (!failed) {
        run.appendOutput(`dbt tests completed for pipeline "${ref.pipeline}".\n`);
      }

      if (failed) {
        deps.revealSkipprOutput();
        run.appendOutput("\n--- CLI stderr / stdout (tail) ---\n");
        run.appendOutput(clipText(`${stderr}\n${stdout}`, 12000) + "\n");
        logTestRunBanner(
          deps,
          `skippr test run (${ref.pipeline})`,
          clipText(`${stderr}\n${stdout}`, 16000)
        );
        void offerShowSkipprOutput(`dbt tests failed for pipeline "${ref.pipeline}".`, deps);

        for (const it of items) {
          if (token.isCancellationRequested) {
            run.skipped(it);
            continue;
          }
          const c = parseDbtChildTestId(it.id);
          if (c) {
            const row = results.get(c.uniqueId);
            const st = (row?.status ?? "").toLowerCase();
            if (st === "pass") {
              run.passed(it, Date.now());
            } else if (st === "skipped" || st === "skip") {
              run.skipped(it);
            } else if (st === "fail" || st === "failed") {
              const msg = new vscode.TestMessage(row?.message ?? "dbt test failed");
              run.failed(it, msg, Date.now());
            } else if (row) {
              const msg = new vscode.TestMessage(row?.message ?? `dbt test status: ${row?.status ?? "error"}`);
              run.failed(it, msg, Date.now());
            } else {
              const msg = new vscode.TestMessage(
                markdownForRunDiagnostics(
                  ref.pipeline,
                  code,
                  stderr,
                  stdout,
                  testErrors,
                  `No JSONL result for test \`${c.uniqueId}\`; see CLI output below.`
                )
              );
              run.failed(it, msg, Date.now());
            }
          } else {
            const headline =
              selects.size === 0
                ? "**dbt test run reported failures or errors.**"
                : "**One or more selected dbt tests failed.**";
            const msg = new vscode.TestMessage(
              markdownForRunDiagnostics(ref.pipeline, code, stderr, stdout, testErrors, headline)
            );
            run.failed(it, msg, Date.now());
          }
        }
        continue;
      }

      for (const it of items) {
        if (token.isCancellationRequested) {
          run.skipped(it);
          continue;
        }
        const c = parseDbtChildTestId(it.id);
        if (c) {
          const row = results.get(c.uniqueId);
          const st = (row?.status ?? "").toLowerCase();
          if (st === "pass") {
            run.passed(it, Date.now());
          } else if (st === "skipped" || st === "skip") {
            run.skipped(it);
          } else if (st === "fail" || st === "failed") {
            const msg = new vscode.TestMessage(row?.message ?? "dbt test failed");
            run.failed(it, msg, Date.now());
          } else if (row) {
            const msg = new vscode.TestMessage(row?.message ?? `dbt test status: ${row?.status ?? "error"}`);
            run.failed(it, msg, Date.now());
          } else {
            run.passed(it, Date.now());
          }
        } else {
          run.passed(it, Date.now());
        }
      }
    }
  } finally {
    run.end();
  }
}

function dedupeTestItems(items: vscode.TestItem[]): vscode.TestItem[] {
  const m = new Map<string, vscode.TestItem>();
  for (const t of items) {
    m.set(t.id, t);
  }
  return [...m.values()];
}

function collectIncluded(request: vscode.TestRunRequest, controller: vscode.TestController): vscode.TestItem[] {
  if (request.include && request.include.length > 0) {
    const out: vscode.TestItem[] = [];
    const walk = (t: vscode.TestItem): void => {
      out.push(t);
      t.children.forEach(walk);
    };
    for (const t of request.include) {
      walk(t);
    }
    return out;
  }
  const out: vscode.TestItem[] = [];
  controller.items.forEach((t) => {
    out.push(t);
    t.children.forEach((c) => out.push(c));
  });
  return out;
}
