/** Copy and confirmation for cancelling an in-flight Skippr run from the IDE. */

export const CANCEL_RUN_CONFIRM_LABEL = "Cancel run";
export const RELEASE_ORPHAN_LOCK_CONFIRM_LABEL = "Release lock";
export const CANCEL_RUN_DISMISS_LABEL = "Keep running";

export interface CancelRunConfirmationCopy {
  message: string;
  detail: string;
}

export function buildCancelRunConfirmation(
  runLabel: string,
  options: { workspaceRunLock: boolean }
): CancelRunConfirmationCopy {
  const label = runLabel.trim() || "this run";
  const localStop =
    `Stop the Skippr CLI process for “${label}” on this computer. ` +
    "Work already written to your sink is not rolled back.";

  if (!options.workspaceRunLock) {
    return {
      message: `Cancel ${label}?`,
      detail: localStop
    };
  }

  return {
    message: `Cancel ${label}?`,
    detail:
      `${localStop}\n\n` +
      "This workspace uses a shared run lock on Skippr Cloud. Cancelling here also tells the server to release that lock.\n\n" +
      "Only confirm if this IDE started the run. If the same pipeline is still running on CI, another laptop, or a scheduled job, cancelling from here can leave that run and the lock out of sync and block the next sync."
  };
}

export function buildCloudWorkspaceLockReleaseConfirmation(
  workspace: string,
  lock: { runId: string; command: string; pipeline?: string; status: string }
): CancelRunConfirmationCopy {
  const pipe = lock.pipeline?.trim() ? ` · ${lock.pipeline.trim()}` : "";
  const summary = `${lock.command}${pipe}`;
  return {
    message: `Release cloud lock for workspace “${workspace}”?`,
    detail:
      `This tells Skippr Cloud to cancel run ${lock.runId} (${summary}, status: ${lock.status}) and release the exclusive lock on workspace “${workspace}”.\n\n` +
      "Use this when a previous run crashed, the IDE reloaded, or sync is stuck and new discover/sync/model runs return “workspace already running”.\n\n" +
      "Only release if that run is not still active on CI or another machine."
  };
}

export function buildOrphanLockReleaseConfirmation(runLabel: string): CancelRunConfirmationCopy {
  const label = runLabel.trim() || "this run";
  return {
    message: `Release workspace lock for ${label}?`,
    detail:
      "No Skippr CLI is connected in this window—the run is only shown from a saved session (for example after reloading the IDE).\n\n" +
      "Releasing tells Skippr Cloud to cancel this run and clear the workspace lock so you can start a new sync here.\n\n" +
      "Only release if you are sure nothing is still running for this workspace on CI, another machine, or a schedule. " +
      "Releasing while a remote sync is still active can leave data and the lock out of sync."
  };
}
