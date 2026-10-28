/** Pipeline/config from the last skippr.yml code lens or editor context-menu open. */
let activeLensTarget: { configPath: string; pipeline: string } | undefined;

export function setSkipprPipelineLensTarget(configPath: string, pipeline: string): void {
  activeLensTarget = { configPath, pipeline };
}

export function getSkipprPipelineLensTarget(): { configPath: string; pipeline: string } | undefined {
  return activeLensTarget;
}
