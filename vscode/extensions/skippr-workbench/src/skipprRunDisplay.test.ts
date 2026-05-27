import assert from "node:assert/strict";
import test from "node:test";
import { isTerminalHeadlineEvent, runPhaseHint, runTitle } from "./skipprRunDisplay.js";

test("runTitle uses kind and pipeline", () => {
  assert.equal(runTitle({ runKind: "sync-once", pipeline: "bike_hire" }), "Sync · bike_hire");
});

test("runPhaseHint hidden when not running", () => {
  assert.equal(runPhaseHint({ status: "success", phase: "complete" }), "");
});

test("runPhaseHint shows syncing while running", () => {
  assert.equal(runPhaseHint({ status: "running", phase: "syncing" }), "Syncing");
});

test("runPhaseHint hides terminal phase while running", () => {
  assert.equal(runPhaseHint({ status: "running", phase: "complete" }), "");
});

test("isTerminalHeadlineEvent covers sync lifecycle noise", () => {
  assert.equal(isTerminalHeadlineEvent("sync_complete"), true);
  assert.equal(isTerminalHeadlineEvent("batch_ingested"), false);
});
