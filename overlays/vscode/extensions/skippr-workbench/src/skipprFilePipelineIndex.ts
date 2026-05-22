import * as path from "node:path";
import * as vscode from "vscode";
import { detectDbtSqlFile } from "./skipprDbtSql";

export interface SkipprFilePipelineResolution {
  pipeline: string;
  reason: string;
}

function normalizeSegments(value: string): string[] {
  return value.split(/[\\/]+/).map((segment) => segment.trim()).filter(Boolean);
}

function validCandidate(pipeline: string, candidates: readonly string[]): string | undefined {
  const normalized = pipeline.trim();
  if (!normalized) {
    return undefined;
  }
  if (candidates.length === 0) {
    return normalized;
  }
  return candidates.includes(normalized) ? normalized : undefined;
}

export function resolvePipelineForFile(
  uri: vscode.Uri | undefined,
  configPath: string,
  candidates: readonly string[]
): SkipprFilePipelineResolution | undefined {
  if (!uri || uri.scheme !== "file") {
    return undefined;
  }

  const detected = detectDbtSqlFile(uri);
  const dbtPipeline = validCandidate(detected.pipelineFromPath ?? "", candidates);
  if (dbtPipeline) {
    return {
      pipeline: dbtPipeline,
      reason: `File is under ${dbtPipeline}/dbt`
    };
  }

  const configDir = path.dirname(configPath);
  const relative = path.relative(configDir, uri.fsPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }

  const segments = normalizeSegments(relative);
  const firstSegment = segments[0];
  const pipeline = validCandidate(firstSegment ?? "", candidates);
  if (pipeline && segments.length > 1) {
    return {
      pipeline,
      reason: `File is under the ${pipeline} pipeline folder`
    };
  }

  return undefined;
}
