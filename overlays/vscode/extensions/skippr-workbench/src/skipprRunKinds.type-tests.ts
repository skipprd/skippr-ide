import { pipelineName, type SkipprRunKind } from "./skipprRunner.js";
import { runKindLabel } from "./skipprRunKinds.js";

const syncOnce: SkipprRunKind = "sync-once";
const discover: SkipprRunKind = "discover";
void syncOnce;
void discover;

if (runKindLabel("sync-once") !== "Sync") {
  throw new Error(`sync-once label must be Sync, got ${runKindLabel("sync-once")}`);
}
if (runKindLabel("sync") !== "Start Sync") {
  throw new Error(`sync label must be Start Sync, got ${runKindLabel("sync")}`);
}
if (runKindLabel("sync-all-once") !== "Sync all") {
  throw new Error(`sync-all-once label must be Sync all, got ${runKindLabel("sync-all-once")}`);
}

const named = pipelineName("bike_hire");
if (!named) {
  throw new Error("test pipeline should be valid");
}

// @ts-expect-error runKindLabel only accepts SkipprRunKind
runKindLabel("not-a-kind");
