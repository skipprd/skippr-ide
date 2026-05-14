import * as vscode from "vscode";

export const skipprConfigDocumentSelector: vscode.DocumentSelector = [
  { scheme: "file", pattern: "**/skippr.yml" },
  { scheme: "file", pattern: "**/skippr.yaml" }
];

export function isSkipprConfigDocument(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== "file") {
    return false;
  }
  const base = document.uri.path.split("/").pop() ?? "";
  return base === "skippr.yml" || base === "skippr.yaml";
}

/** Top-level `pipelines:` entry names (direct children), line-indexed. */
export function listPipelineDefinitionLines(text: string): Array<{ line: number; name: string }> {
  const lines = text.split(/\r?\n/);
  const out: Array<{ line: number; name: string }> = [];
  let inPipelines = false;
  let sectionIndent = 0;
  let childIndent: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const wsMatch = raw.match(/^(\s*)/);
    const indent = wsMatch ? wsMatch[1].length : 0;
    const keyMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*:\s*(.*)$/);
    if (!keyMatch) {
      continue;
    }
    const key = keyMatch[1];
    const rest = keyMatch[2];
    const valuePart = rest.replace(/\s+#.*$/, "").trim();

    if (key === "pipelines") {
      inPipelines = true;
      sectionIndent = indent;
      childIndent = null;
      continue;
    }

    if (!inPipelines) {
      continue;
    }

    if (indent <= sectionIndent) {
      inPipelines = false;
      continue;
    }

    if (childIndent === null) {
      childIndent = indent;
    }

    if (indent < (childIndent ?? 0)) {
      inPipelines = false;
      continue;
    }

    if (indent !== childIndent) {
      continue;
    }

    if (trimmed.startsWith("- ")) {
      continue;
    }

    if (
      valuePart &&
      valuePart !== "|" &&
      valuePart !== ">" &&
      !valuePart.startsWith("{") &&
      !valuePart.startsWith("[")
    ) {
      continue;
    }

    out.push({ line: i, name: key });
  }

  return out;
}
