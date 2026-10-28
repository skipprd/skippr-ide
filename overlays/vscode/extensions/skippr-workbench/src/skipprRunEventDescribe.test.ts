import assert from "node:assert/strict";
import test from "node:test";
import { describedRunEvents, describeRunEvent } from "./skipprRunEventDescribe";

test("describeRunEvent names discover and sync lifecycle", () => {
  assert.equal(
    describeRunEvent({ event: "discover_start", pipeline: "bike_hire" }),
    "Discover started: bike_hire"
  );
  assert.equal(
    describeRunEvent({ event: "sync_complete", pipeline: "bike_hire", total_rows: 12 }),
    "Sync complete: bike_hire rows=12"
  );
});

test("describeRunEvent hides successful tool_end", () => {
  assert.equal(describeRunEvent({ event: "tool_end", status: "ok" }), undefined);
  assert.equal(describeRunEvent({ event: "tool_start" }), undefined);
});

test("describeRunEvent reports failed model validation", () => {
  assert.equal(
    describeRunEvent({
      event: "model_validation",
      validation: { ok: false, message: "dbt failed" }
    }),
    "Model validation failed: dbt failed"
  );
});

test("describedRunEvents stamps describeRunEvent onto each event", () => {
  const [row] = describedRunEvents([{ event: "sync_start", pipeline: "bike_hire" }]);
  assert.equal(row?.description, "Sync started: bike_hire");
});
