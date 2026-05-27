import assert from "node:assert/strict";
import {
  buildDiscoverPayload,
  buildSyncPayload,
  catalogNodesFromGraph,
  latestRunForPipeline,
  matchesWorkflowKind,
  runsForPipeline,
  schemasFromRun
} from "./skipprWorkflowData";
import type { SkipprObservedRun, SkipprRunStateSnapshot } from "./skipprRunState";

function run(partial: Partial<SkipprObservedRun> & Pick<SkipprObservedRun, "id" | "command" | "runKind">): SkipprObservedRun {
  return {
    label: partial.command,
    status: "success",
    startedAt: partial.startedAt ?? 1,
    headline: partial.command,
    modelChangedFiles: [],
    modelFileSummary: {},
    metricPoints: [],
    affectedAssets: [],
    schemas: {},
    schemaChanges: [],
    events: [],
    ...partial
  };
}

function snapshot(partial: Partial<SkipprRunStateSnapshot>): SkipprRunStateSnapshot {
  return {
    type: "observability",
    history: [],
    ...partial
  };
}

assert.equal(matchesWorkflowKind({ runKind: "discover", command: "discover" }, "discover"), true);
assert.equal(matchesWorkflowKind({ runKind: "sync-once", command: "sync" }, "sync"), true);
assert.equal(matchesWorkflowKind({ runKind: "sync-all-once", command: "sync-all-once" }, "sync"), true);
assert.equal(matchesWorkflowKind({ runKind: "model", command: "model" }, "model"), true);
assert.equal(matchesWorkflowKind({ runKind: "discover", command: "discover" }, "sync"), false);

const obs = snapshot({
  current: run({ id: "c1", command: "discover", runKind: "discover", pipeline: "bike", startedAt: 100 }),
  history: [
    {
      id: "h1",
      command: "sync-once",
      runKind: "sync-once",
      label: "sync-once",
      pipeline: "bike",
      status: "success",
      startedAt: 90
    },
    {
      id: "h2",
      command: "discover",
      runKind: "discover",
      label: "discover",
      pipeline: "bike",
      status: "success",
      startedAt: 80
    }
  ]
});

assert.equal(latestRunForPipeline("discover", "bike", obs)?.id, "c1");
assert.equal(latestRunForPipeline("sync", "bike", obs)?.id, "h1");
assert.equal(runsForPipeline("discover", "bike", obs).map((r) => r.id).join(","), "c1,h2");

const schemaRun = run({
  id: "s1",
  command: "discover",
  runKind: "discover",
  schemas: {
    ns1: { fields: [{ name: "a" }, { name: "b" }] }
  }
});
assert.deepEqual(schemasFromRun(schemaRun), [{ namespace: "ns1", fieldCount: 2 }]);

const graph = catalogNodesFromGraph({
  nodes: [
    { id: "t1", label: "orders", kind: "WarehouseTable", dataset_id: "orders" },
    { id: "f1", label: "id", kind: "Field", dataset_id: "orders", field: { dataset_id: "orders", field_path: "id" } },
    { id: "x1", label: "skip", kind: "Other" }
  ]
});
assert.equal(graph.length, 1);
assert.equal(graph[0]?.fieldCount, 1);

const discoverPayload = buildDiscoverPayload({
  status: "ready",
  show: { ok: true, config_path: "/w/skippr.yml", pipelines: ["bike"], sources: [], sinks: [], schema_sinks: [] },
  selectedPipeline: "bike",
  snapshot: obs,
  run: schemaRun
});
assert.equal(discoverPayload.type, "discoverWorkflow");
assert.equal(discoverPayload.latestRun?.id, "s1");

const syncPayload = buildSyncPayload({
  status: "ready",
  snapshot: obs,
  selectedPipeline: "bike"
});
assert.equal(syncPayload.type, "syncWorkflow");

console.log("skipprWorkflowData.test.ts: ok");
