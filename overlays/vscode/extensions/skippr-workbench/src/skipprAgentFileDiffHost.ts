import * as vscode from "vscode";
import { skipprAgentDiffTitle, skipprBeforeUri } from "./skipprAgentFileDiff";

export class SkipprBeforeContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  set(absolutePath: string, beforeContent: string): vscode.Uri {
    const spec = skipprBeforeUri(absolutePath);
    const uri = vscode.Uri.from({ scheme: spec.scheme, path: spec.path });
    this.contents.set(uri.toString(), beforeContent);
    this.emitter.fire(uri);
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }
}

export async function openSkipprAgentFileDiff(
  provider: SkipprBeforeContentProvider,
  absolutePath: string,
  beforeContent: string
): Promise<void> {
  const beforeUri = provider.set(absolutePath, beforeContent);
  const afterUri = vscode.Uri.file(absolutePath);
  await vscode.commands.executeCommand("vscode.diff", beforeUri, afterUri, skipprAgentDiffTitle(absolutePath));
}
