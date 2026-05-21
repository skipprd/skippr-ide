import { buildRunArgs, pipelineName, type SkipprRunOptions } from "./skipprRunner";

const configPath = "/workspace/skippr.yml";
const pipeline = pipelineName("bike_hire");
if (!pipeline) {
  throw new Error("test pipeline should be valid");
}

const discoverArgs = buildRunArgs({
  kind: "discover",
  cwd: "/workspace",
  configPath,
  pipeline,
  logLevel: "",
  discoverOutput: "json"
});

if (discoverArgs.join(" ") !== "--config /workspace/skippr.yml discover --pipeline bike_hire --output json") {
  throw new Error(`unexpected discover args: ${discoverArgs.join(" ")}`);
}

const syncAllArgs = buildRunArgs({
  kind: "sync-all-once",
  cwd: "/workspace",
  configPath,
  logLevel: ""
});

if (syncAllArgs.includes("--pipeline")) {
  throw new Error("sync-all-once must not accept a pipeline argument");
}

// @ts-expect-error Pipeline-scoped runs must carry a validated PipelineName.
const missingPipeline: SkipprRunOptions = {
  kind: "sync",
  cwd: "/workspace",
  configPath,
  logLevel: ""
};
void missingPipeline;

const syncAllWithPipeline: SkipprRunOptions = {
  kind: "sync-all-once",
  cwd: "/workspace",
  configPath,
  // @ts-expect-error Pipeline-free runs must not carry a pipeline.
  pipeline,
  logLevel: ""
};
void syncAllWithPipeline;
