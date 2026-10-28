import assert from "node:assert/strict";
import test from "node:test";
import {
  INSTALL_SDE_ARGV,
  LOCAL_CARGO_PACKAGE,
  PRODUCT_CLI,
  UPGRADE_SDE_ARGV,
  buildLocalSdeCargoCommand,
  buildSdeMetadataApplyArgs,
  buildSdeRunArgs,
  installedProductCliCandidates,
  pipelineName
} from "./skipprSdeArgv";

test("product CLI is sde", () => {
  assert.equal(PRODUCT_CLI, "sde");
  assert.equal(LOCAL_CARGO_PACKAGE, "sde");
  assert.ok(installedProductCliCandidates().every((candidate) => candidate.endsWith("sde")));
  assert.ok(!installedProductCliCandidates().some((candidate) => candidate.endsWith("skippr")));
});

test("model argv matches sde ModelArgs", () => {
  const pipeline = pipelineName("orders_el");
  assert.ok(pipeline);
  const args = buildSdeRunArgs(
    {
      kind: "model",
      cwd: "/workspace",
      configPath: "/workspace/skippr.yml",
      pipeline,
      logLevel: "info",
      modelNoResume: true
    },
    "/workspace"
  );
  assert.deepEqual(args, [
    "--config",
    "/workspace/skippr.yml",
    "--log",
    "info",
    "model",
    "--pipeline",
    "orders_el",
    "--dbt-output-path",
    "/workspace/orders_el/dbt",
    "--no-resume",
    "--output",
    "jsonl"
  ]);
  assert.ok(!args.includes("--goal"));
  assert.ok(!args.includes("--scope"));
  assert.ok(!args.includes("--target-models"));
  assert.ok(!args.includes("--artifacts"));
});

test("local cargo spawn is cargo run -p sde from the sde workspace", () => {
  const command = buildLocalSdeCargoCommand("/repos/sde/Cargo.toml", ["model", "--pipeline", "orders_el"]);
  assert.deepEqual(command, [
    "cargo",
    "run",
    "--manifest-path",
    "/repos/sde/Cargo.toml",
    "-p",
    "sde",
    "--",
    "model",
    "--pipeline",
    "orders_el"
  ]);
  assert.ok(!command.includes("skippr-cli"));
  assert.ok(!command.some((part) => part.endsWith("skipprd/Cargo.toml")));
});

test("install and update argv is brew sde", () => {
  assert.deepEqual([...INSTALL_SDE_ARGV], ["brew", "install", "sde"]);
  assert.deepEqual([...UPGRADE_SDE_ARGV], ["brew", "upgrade", "sde"]);
});

test("metadata apply argv matches sde MetadataArgs", () => {
  const args = buildSdeMetadataApplyArgs({
    configPath: "/workspace/skippr.yml",
    logLevel: "info",
    pipeline: "orders_el",
    namespace: "bronze.orders",
    schemaJson: "{\"fields\":[]}"
  });
  assert.deepEqual(args, [
    "--config",
    "/workspace/skippr.yml",
    "--log",
    "info",
    "metadata",
    "apply",
    "--pipeline",
    "orders_el",
    "--namespace",
    "bronze.orders",
    "--schema-json",
    "{\"fields\":[]}",
    "--evolved",
    "--output",
    "json"
  ]);
});
