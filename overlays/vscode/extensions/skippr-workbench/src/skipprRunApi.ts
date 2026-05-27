import type { SkipprObservedRun, SkipprRunHistorySummary } from "./skipprRunState";
import { summarizeRun } from "./skipprRunState";

export interface AcquireLockResult {
  runId: string;
  version: number;
  leaseExpiresAt: string;
}

export interface LockConflictBody {
  error?: string;
  activeRunId?: string;
  activeCommand?: string;
  activePipeline?: string;
  activeStatus?: string;
}

export type ApiRequestFn = (
  path: string,
  method: string,
  body?: unknown,
  token?: string
) => Promise<Response>;

export function isHeavyRunKind(kind: string): boolean {
  return ["discover", "sync", "sync-once", "sync-all-once", "model"].includes(kind);
}

export function heavyCommandForKind(kind: string): string {
  if (kind === "sync-once") {
    return "sync-once";
  }
  if (kind === "sync-all-once") {
    return "sync-all-once";
  }
  return kind;
}

export async function acquireWorkspaceRunLock(
  apiRequest: ApiRequestFn,
  token: string,
  workspace: string,
  command: string,
  pipeline: string | undefined,
  runId?: string
): Promise<AcquireLockResult> {
  const response = await apiRequest(
    `/auth/workspaces/${encodeURIComponent(workspace)}/runs/lock/acquire`,
    "POST",
    { command, pipeline, runId },
    token
  );
  if (response.status === 409) {
    const conflict = (await response.json().catch(() => ({}))) as LockConflictBody;
    const pipe = conflict.activePipeline ? ` on pipeline '${conflict.activePipeline}'` : "";
    throw new Error(
      conflict.error ??
        `Workspace already running ${conflict.activeCommand ?? "a job"}${pipe} (run ${conflict.activeRunId ?? "unknown"}). Stop or wait for it to finish.`
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `acquire run lock failed (${response.status})`);
  }
  return (await response.json()) as AcquireLockResult;
}

export async function cancelWorkspaceRun(
  apiRequest: ApiRequestFn,
  token: string,
  workspace: string,
  runId: string
): Promise<void> {
  const response = await apiRequest(
    `/auth/workspaces/${encodeURIComponent(workspace)}/runs/${encodeURIComponent(runId)}/cancel`,
    "POST",
    undefined,
    token
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `cancel run failed (${response.status})`);
  }
}

export async function completeWorkspaceRunLock(
  apiRequest: ApiRequestFn,
  token: string,
  workspace: string,
  runId: string,
  version: number,
  status: "completed" | "failed" | "cancelled"
): Promise<void> {
  const response = await apiRequest(
    `/auth/workspaces/${encodeURIComponent(workspace)}/runs/lock/complete`,
    "POST",
    { runId, version, status },
    token
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `complete run lock failed (${response.status})`);
  }
}

export async function putWorkspaceRun(
  apiRequest: ApiRequestFn,
  token: string,
  workspace: string,
  run: SkipprObservedRun
): Promise<void> {
  const summary = summarizeRun(run);
  const response = await apiRequest(
    `/auth/workspaces/${encodeURIComponent(workspace)}/runs/${encodeURIComponent(run.id)}`,
    "PUT",
    {
      command: run.command,
      pipeline: run.pipeline,
      status: run.status,
      payload: run,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      elapsedMs: summary.elapsedMs
    },
    token
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `put run failed (${response.status})`);
  }
}

export async function listWorkspaceRuns(
  apiRequest: ApiRequestFn,
  token: string,
  workspace: string,
  limit = 50
): Promise<SkipprRunHistorySummary[]> {
  const response = await apiRequest(
    `/auth/workspaces/${encodeURIComponent(workspace)}/runs?limit=${limit}`,
    "GET",
    undefined,
    token
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `list runs failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    runs?: Array<{
      runId: string;
      command: string;
      pipeline?: string;
      status: SkipprRunHistorySummary["status"];
      startedAt: string;
      finishedAt?: string;
      elapsedMs?: number;
    }>;
  };
  return (payload.runs ?? []).map((row) => ({
    id: row.runId,
    command: row.command,
    runKind: row.command,
    label: row.command,
    pipeline: row.pipeline,
    status: row.status,
    startedAt: Date.parse(row.startedAt) || Date.now(),
    finishedAt: row.finishedAt ? Date.parse(row.finishedAt) : undefined,
    elapsedMs: row.elapsedMs
  }));
}

export async function loadWorkspaceRun(
  apiRequest: ApiRequestFn,
  token: string,
  workspace: string,
  runId: string
): Promise<SkipprObservedRun | undefined> {
  const response = await apiRequest(
    `/auth/workspaces/${encodeURIComponent(workspace)}/runs/${encodeURIComponent(runId)}`,
    "GET",
    undefined,
    token
  );
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `get run failed (${response.status})`);
  }
  const payload = (await response.json()) as { payload?: SkipprObservedRun };
  return payload.payload;
}
