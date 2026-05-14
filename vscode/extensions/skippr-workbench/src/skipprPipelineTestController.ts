import * as vscode from "vscode";
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

function makePipelineTestId(configFsPath: string, pipeline: string): string {
  return JSON.stringify([configFsPath, pipeline]);
}

function parsePipelineTestId(id: string): { configFsPath: string; pipeline: string } | undefined {
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

function collectRequestedTests(request: vscode.TestRunRequest, controller: vscode.TestController): vscode.TestItem[] {
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
  });
  return out;
}

/**
 * Publishes each top-level `pipelines:` entry as a {@link vscode.TestItem} so VS Code
 * shows the standard run affordance in the **testing gutter** (line margin), not CodeLens.
 */
export function registerSkipprPipelineTestController(
  context: vscode.ExtensionContext,
  runPick: (configFsPath: string, pipeline: string) => Promise<boolean>
): void {
  const controller = vscode.tests.createTestController("skippr.pipelineRun", "Skippr pipelines");
  controller.label = "Skippr pipelines";

  const syncDocument = (document: vscode.TextDocument): void => {
    if (!isSkipprConfigDocument(document)) {
      return;
    }
    removeItemsForFile(controller, document.uri);
    const defs = listPipelineDefinitionLines(document.getText());
    for (const { line, name } of defs) {
      const id = makePipelineTestId(document.uri.fsPath, name);
      const item = controller.createTestItem(id, name, document.uri);
      const lineText = document.lineAt(line).text;
      item.range = new vscode.Range(line, 0, line, Math.max(lineText.length, 0));
      item.description = "pipeline";
      controller.items.add(item);
    }
  };

  controller.createRunProfile("Run", vscode.TestRunProfileKind.Run, async (request, token) => {
    const run = controller.createTestRun(request);
    try {
      const items = collectRequestedTests(request, controller);
      for (const test of items) {
        if (token.isCancellationRequested) {
          break;
        }
        const parsed = parsePipelineTestId(test.id);
        if (!parsed) {
          run.errored(test, new vscode.TestMessage("Invalid Skippr pipeline test id"), Date.now());
          continue;
        }
        run.started(test);
        const ran = await runPick(parsed.configFsPath, parsed.pipeline);
        if (token.isCancellationRequested) {
          run.skipped(test);
        } else if (ran) {
          run.passed(test, Date.now());
        } else {
          run.skipped(test);
        }
      }
    } finally {
      run.end();
    }
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
