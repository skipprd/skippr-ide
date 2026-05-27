import test from "node:test";
import assert from "node:assert/strict";
import { buildCancelRunConfirmation, buildOrphanLockReleaseConfirmation } from "./skipprRunCancel.js";

test("buildCancelRunConfirmation without workspace lock is local-only", () => {
  const copy = buildCancelRunConfirmation("Sync · bike_hire", { workspaceRunLock: false });
  assert.match(copy.message, /bike_hire/);
  assert.match(copy.detail, /CLI process/);
  assert.doesNotMatch(copy.detail, /shared run lock/i);
});

test("buildCancelRunConfirmation with workspace lock warns about remote runs", () => {
  const copy = buildCancelRunConfirmation("Sync · orders", { workspaceRunLock: true });
  assert.match(copy.detail, /shared run lock/i);
  assert.match(copy.detail, /CI/i);
  assert.match(copy.detail, /Only confirm if this IDE started/i);
});

test("buildOrphanLockReleaseConfirmation explains detached session and remote risk", () => {
  const copy = buildOrphanLockReleaseConfirmation("Sync · bike_hire");
  assert.match(copy.message, /Release workspace lock/i);
  assert.match(copy.detail, /No Skippr CLI is connected/i);
  assert.match(copy.detail, /clear the workspace lock/i);
  assert.match(copy.detail, /CI/i);
});
