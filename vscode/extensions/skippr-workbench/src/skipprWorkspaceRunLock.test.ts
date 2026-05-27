import test from "node:test";
import assert from "node:assert/strict";
import { isWorkspaceLockBlocking, workspaceLockPanelFromApi } from "./skipprWorkspaceRunLock.js";

test("isWorkspaceLockBlocking is true for running lock with valid lease", () => {
  const lock = {
    runId: "a",
    command: "sync-once",
    pipeline: "bike_hire",
    status: "running",
    version: 1,
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    cancelRequested: false
  };
  assert.equal(isWorkspaceLockBlocking(lock), true);
});

test("isWorkspaceLockBlocking is false for failed or cancelled locks", () => {
  const base = {
    runId: "a",
    command: "sync-once",
    status: "failed",
    version: 2,
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    cancelRequested: false
  };
  assert.equal(isWorkspaceLockBlocking(base), false);
  assert.equal(isWorkspaceLockBlocking({ ...base, status: "cancelled" }), false);
  assert.equal(isWorkspaceLockBlocking({ ...base, status: "running", cancelRequested: true }), false);
});

test("workspaceLockPanelFromApi sets blocking from lock", () => {
  const panel = workspaceLockPanelFromApi(
    "mssql-migration",
    true,
    {
      runId: "x",
      command: "sync",
      status: "running",
      version: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      cancelRequested: false
    }
  );
  assert.equal(panel.blocking, true);
  assert.equal(panel.workspace, "mssql-migration");
});
