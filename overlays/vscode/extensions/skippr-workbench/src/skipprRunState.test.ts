import test from "node:test";
import assert from "node:assert/strict";
import { historyExcludingCurrent, type SkipprRunHistorySummary } from "./skipprRunState";

function row(
  overrides: Partial<SkipprRunHistorySummary> & Pick<SkipprRunHistorySummary, "id">
): SkipprRunHistorySummary {
  return {
    command: "sync",
    runKind: "sync",
    label: "sync",
    status: "success",
    startedAt: 1,
    ...overrides
  };
}

test("historyExcludingCurrent removes the active run by id", () => {
  const current = {
    id: "run-a",
    command: "sync",
    runKind: "sync",
    label: "sync",
    status: "running" as const,
    startedAt: 2,
    headline: "sync",
    modelChangedFiles: [],
    modelFileSummary: {},
    metricPoints: [],
    affectedAssets: [],
    schemas: {},
    schemaChanges: [],
    events: []
  };
  const history = [row({ id: "run-a", status: "running" }), row({ id: "run-b" })];
  const visible = historyExcludingCurrent(history, current);
  assert.equal(visible.length, 1);
  assert.equal(visible[0]?.id, "run-b");
});

test("historyExcludingCurrent removes lock run id and other running rows", () => {
  const current = {
    id: "cli-uuid",
    command: "sync",
    runKind: "sync",
    label: "sync",
    status: "running" as const,
    startedAt: 2,
    headline: "sync",
    workspaceRunLock: { workspace: "ws", runId: "cloud-run", version: 3 },
    modelChangedFiles: [],
    modelFileSummary: {},
    metricPoints: [],
    affectedAssets: [],
    schemas: {},
    schemaChanges: [],
    events: []
  };
  const history = [
    row({ id: "cli-uuid", status: "running" }),
    row({ id: "cloud-run", status: "running" }),
    row({ id: "old-uuid", status: "running" }),
    row({ id: "done", status: "success" })
  ];
  const visible = historyExcludingCurrent(history, current);
  assert.deepEqual(
    visible.map((r) => r.id),
    ["done"]
  );
});

test("historyExcludingCurrent passes through when no current run", () => {
  const history = [row({ id: "run-a" }), row({ id: "run-b" })];
  assert.deepEqual(historyExcludingCurrent(history, undefined), history);
});
