import * as vscode from "vscode";

export type SkipprPipelineRunCommand = "discover" | "sync" | "model" | "doctor";

interface SkipprPipelineActionPick extends vscode.QuickPickItem {
  command: SkipprPipelineRunCommand;
}

const PIPELINE_ACTIONS: SkipprPipelineActionPick[] = [
  {
    label: "$(search) Discover",
    description: "Discover namespaces (same as Run Skippr title bar)",
    command: "discover"
  },
  {
    label: "$(sync) Sync",
    description: "One bounded sync pass (sync-once)",
    command: "sync"
  },
  {
    label: "$(circuit-board) Model",
    description: "Run Skippr model for this pipeline",
    command: "model"
  },
  {
    label: "$(pass) Doctor",
    description: "Validate environment and configuration",
    command: "doctor"
  }
];

/** Menu-style picker (no filter box) for gutter Run on skippr.yml pipeline keys. */
export function pickSkipprPipelineAction(pipeline: string): Promise<SkipprPipelineActionPick | undefined> {
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<SkipprPipelineActionPick>();
    quickPick.hideInput = true;
    quickPick.title = `Run Skippr — ${pipeline}`;
    quickPick.items = PIPELINE_ACTIONS;
    quickPick.placeholder = undefined;

    let picked: SkipprPipelineActionPick | undefined;

    const accept = (item: SkipprPipelineActionPick | undefined) => {
      picked = item;
      quickPick.hide();
    };

    quickPick.onDidChangeSelection((selection) => {
      if (selection[0]) {
        accept(selection[0]);
      }
    });
    quickPick.onDidAccept(() => {
      accept(quickPick.selectedItems[0] ?? quickPick.activeItems[0]);
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve(picked);
    });

    quickPick.show();
  });
}
