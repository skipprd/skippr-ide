import assert from "node:assert/strict";
import test from "node:test";
import { VECTOR_INGEST_KEY, buildVectorIngestArgs } from "./skipprSdeArgv";

test("vector ingest names its vector source and Lance scope", () => {
  const args = buildVectorIngestArgs("/w/skippr.yml", "/w", ["**/.git/**"]);
  assert.deepEqual(args, [
    "--config",
    "/w/skippr.yml",
    "vector",
    "ingest-docs",
    "--vector-source",
    VECTOR_INGEST_KEY,
    "--pipeline",
    VECTOR_INGEST_KEY,
    "--src-path",
    "/w",
    "--include-glob",
    "**/*",
    "--output",
    "json",
    "--exclude-glob",
    "**/.git/**"
  ]);
});
