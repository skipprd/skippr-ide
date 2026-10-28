import { buildSdeRunArgs, pipelineName, type SkipprRunOptions } from "./skipprSdeArgv";

const configPath = "/workspace/skippr.yml";
const pipeline = pipelineName("bike_hire");
if (!pipeline) {
  throw new Error("test pipeline should be valid");
}

const discoverArgs = buildSdeRunArgs(
  {
    kind: "discover",
    cwd: "/workspace",
    configPath,
    pipeline,
    logLevel: "",
    discoverOutput: "json"
  },
  "/workspace"
);

if (discoverArgs.join(" ") !== "--config /workspace/skippr.yml discover --pipeline bike_hire --output json") {
  throw new Error(`unexpected discover args: ${discoverArgs.join(" ")}`);
}

const syncAllArgs = buildSdeRunArgs(
  {
    kind: "sync-all-once",
    cwd: "/workspace",
    configPath,
    logLevel: ""
  },
  "/workspace"
);

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

const modelRun: SkipprRunOptions = {
  kind: "model",
  cwd: "/workspace",
  configPath,
  pipeline,
  logLevel: "",
  modelNoResume: true
};
void modelRun;

const modelWithGoal: SkipprRunOptions = {
  kind: "model",
  cwd: "/workspace",
  configPath,
  pipeline,
  logLevel: "",
  // @ts-expect-error sde model does not take --goal
  modelGoal: "x"
};
void modelWithGoal;
