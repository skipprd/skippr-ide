/** Skippr Cloud workspace run lock (auth API) — visibility and blocking checks for the IDE. */

export interface WorkspaceRunLockStatus {
  runId: string;
  command: string;
  pipeline?: string;
  status: string;
  version: number;
  leaseExpiresAt: string;
  cancelRequested: boolean;
}

export interface WorkspaceLockPanelState {
  workspace?: string;
  signedIn: boolean;
  lock?: WorkspaceRunLockStatus;
  /** True when this lock prevents acquiring a new heavy run. */
  blocking: boolean;
  loadError?: string;
}

const TERMINAL_LOCK_STATUSES = new Set(["completed", "failed", "cancelled", "orphaned"]);

export function isWorkspaceLockBlocking(lock: WorkspaceRunLockStatus, nowMs = Date.now()): boolean {
  if (lock.cancelRequested) {
    return false;
  }
  if (TERMINAL_LOCK_STATUSES.has(lock.status)) {
    return false;
  }
  const leaseMs = Date.parse(lock.leaseExpiresAt);
  if (Number.isFinite(leaseMs) && leaseMs < nowMs) {
    return false;
  }
  return true;
}

export function workspaceLockPanelFromApi(
  workspace: string,
  signedIn: boolean,
  lock: WorkspaceRunLockStatus | undefined,
  loadError?: string
): WorkspaceLockPanelState {
  return {
    workspace,
    signedIn,
    lock,
    blocking: lock ? isWorkspaceLockBlocking(lock) : false,
    loadError
  };
}

export function formatWorkspaceLockSummary(lock: WorkspaceRunLockStatus): string {
  const pipe = lock.pipeline?.trim() ? ` · ${lock.pipeline.trim()}` : "";
  return `${lock.command}${pipe}`;
}

export function shortRunId(runId: string): string {
  const id = runId.trim();
  if (id.length <= 12) {
    return id;
  }
  return `${id.slice(0, 8)}…`;
}
