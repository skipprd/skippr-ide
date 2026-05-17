export type SkipprPipelineRunCommand = "discover" | "sync" | "model" | "model-direct" | "doctor";

/** Config/pipeline for the next gutter Run menu action (set before `skippr.showPipelineRunMenu`). */
let pendingLensRun: { configPath: string; pipeline: string } | undefined;

export function setPendingPipelineLensRun(configPath: string, pipeline: string): void {
  pendingLensRun = { configPath, pipeline };
}

export function takePendingPipelineLensRun(): { configPath: string; pipeline: string } | undefined {
  const ctx = pendingLensRun;
  pendingLensRun = undefined;
  return ctx;
}
