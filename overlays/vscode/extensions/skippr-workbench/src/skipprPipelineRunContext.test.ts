import assert from "node:assert/strict";
import test from "node:test";
import { isSkipprPipelineRunCommand } from "./skipprPipelineRunContext";

test("isSkipprPipelineRunCommand accepts the pipeline run union", () => {
  assert.equal(isSkipprPipelineRunCommand("discover"), true);
  assert.equal(isSkipprPipelineRunCommand("sync"), true);
  assert.equal(isSkipprPipelineRunCommand("model"), true);
  assert.equal(isSkipprPipelineRunCommand("doctor"), true);
  assert.equal(isSkipprPipelineRunCommand("lineage"), true);
});

test("isSkipprPipelineRunCommand rejects unknown actions", () => {
  assert.equal(isSkipprPipelineRunCommand("pick"), false);
  assert.equal(isSkipprPipelineRunCommand(""), false);
  assert.equal(isSkipprPipelineRunCommand(undefined), false);
});
