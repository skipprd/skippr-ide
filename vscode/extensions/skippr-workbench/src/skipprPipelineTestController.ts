import * as vscode from "vscode";
import {
  parsePipelineParentId,
  resolveDbtChildrenForPipelineItem,
  runDbtTestsForRequest,
  type SkipprDbtTestDeps
} from "./skipprDbtTestController";
import {
  ensureLocalRuntimePluginManifests,
  spawnEnvWithCachedLocalRuntimePlugins
} from "./skipprLocalRuntimePlugins";
import { isSkipprConfigDocument, listPipelineDefinitionLines } from "./skipprPipelineCodeLens";

function removeItemsForFile(controller: vscode.TestController, uri: vscode.Uri): void {
  const toDelete: string[] = [];
  controller.items.forEach((item) => {
    if (item.uri?.toString() === uri.toString()) {
      toDelete.push(item.id);
    }
  });
  for (const id of toDelete) {
    controller.items.delete(id);
  }
}

function makePipelineParentTestId(configFsPath: string, pipeline: string): string {
  return JSON.stringify([configFsPath, pipeline]);
}

export interface SkipprPipelineTestHostDeps {
  output: vscode.LogOutputChannel;
  resolveCliPath: () => Promise<string | undefined>;
  getConfigCwd: (configFsPath: string) => string;
  /** Open the Skippr output channel (e.g. after a test or discovery failure). */
  revealSkipprOutput?: () => void;
  getLogLevel?: () => string;
  getRunExtraArgsText?: () => string;
}

/**
 * Registers the Skippr pipeline test controller: one parent {@link vscode.TestItem} per pipeline
 * line in `skippr.yml`, with lazy dbt child discovery via `skippr test list`.
 */
export function registerSkipprPipelineTestControllers(
  context: vscode.ExtensionContext,
  deps: SkipprPipelineTestHostDeps
): void {
  const controller = vscode.tests.createTestController("skippr.pipelineTests", "Skippr pipeline tests");
  controller.label = "Skippr pipeline tests";

  const revealSkipprOutput = deps.revealSkipprOutput ?? (() => deps.output.show(false));
  const dbtDeps: SkipprDbtTestDeps = {
    output: deps.output,
    resolveCliPath: deps.resolveCliPath,
    getConfigCwd: deps.getConfigCwd,
    revealSkipprOutput,
    getSpawnEnv: (ref) => spawnEnvWithCachedLocalRuntimePlugins(process.env, ref.configFsPath, ref.pipeline),
    getLogLevel: deps.getLogLevel,
    getRunExtraArgsText: deps.getRunExtraArgsText
  };

  controller.resolveHandler = async (item) => {
    if (!item) {
      return;
    }
    if (item.parent) {
      return;
    }
    const ref = parsePipelineParentId(item.id);
    if (!ref) {
      return;
    }
    await ensureLocalRuntimePluginManifests(ref.configFsPath, ref.pipeline, deps.output);
    await resolveDbtChildrenForPipelineItem(controller, item, ref, dbtDeps);
  };

  const syncDocument = (document: vscode.TextDocument): void => {
    if (!isSkipprConfigDocument(document)) {
      return;
    }
    removeItemsForFile(controller, document.uri);
    const defs = listPipelineDefinitionLines(document.getText());
    for (const { line, name } of defs) {
      const id = makePipelineParentTestId(document.uri.fsPath, name);
      const testItem = controller.createTestItem(id, name, document.uri);
      const lineText = document.lineAt(line).text;
      testItem.range = new vscode.Range(line, 0, line, Math.max(lineText.length, 0));
      testItem.description = "pipeline";
      testItem.canResolveChildren = true;
      controller.items.add(testItem);
    }
  };

  controller.createRunProfile("Run dbt tests", vscode.TestRunProfileKind.Run, async (request, token) => {
    const run = controller.createTestRun(request);
    await runDbtTestsForRequest(controller, request, run, token, dbtDeps);
  }, true);

  controller.refreshHandler = async () => {
    for (const doc of vscode.workspace.textDocuments) {
      syncDocument(doc);
    }
  };

  context.subscriptions.push(controller);
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(syncDocument));
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      syncDocument(e.document);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((d) => {
      if (isSkipprConfigDocument(d)) {
        removeItemsForFile(controller, d.uri);
      }
    })
  );

  for (const doc of vscode.workspace.textDocuments) {
    syncDocument(doc);
  }
}
