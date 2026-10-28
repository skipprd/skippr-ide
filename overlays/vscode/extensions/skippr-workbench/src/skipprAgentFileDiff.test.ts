import assert from "node:assert/strict";
import test from "node:test";
import { SKIPPR_BEFORE_SCHEME, skipprBeforeUri, skipprAgentDiffTitle } from "./skipprAgentFileDiff.js";

test("skippr-before URI is scheme plus absolute path", () => {
  const uri = skipprBeforeUri("/tmp/proj/pipeline/dbt/models/foo.sql");
  assert.equal(uri.scheme, SKIPPR_BEFORE_SCHEME);
  assert.equal(uri.path, "/tmp/proj/pipeline/dbt/models/foo.sql");
});

test("diff title names the file", () => {
  assert.equal(skipprAgentDiffTitle("/tmp/proj/dbt/models/foo.sql"), "foo.sql (Skippr Agent)");
});
