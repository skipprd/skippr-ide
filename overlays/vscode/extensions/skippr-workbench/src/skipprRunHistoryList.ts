/** Previous-runs list: never include the active run (or other in-progress duplicates). */
export function historyExcludingCurrent<T extends { id: string; status: string }>(
  history: T[],
  current?: { id: string; status: string; workspaceRunLock?: { runId: string } }
): T[] {
  if (!current) {
    return history;
  }
  const currentIds = new Set<string>([current.id]);
  const lockRunId = current.workspaceRunLock?.runId.trim();
  if (lockRunId) {
    currentIds.add(lockRunId);
  }
  return history.filter((row) => {
    if (currentIds.has(row.id)) {
      return false;
    }
    if (current.status === "running" && row.status === "running") {
      return false;
    }
    return true;
  });
}
