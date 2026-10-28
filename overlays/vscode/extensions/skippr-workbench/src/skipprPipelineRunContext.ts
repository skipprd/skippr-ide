export const SKIPPR_PIPELINE_RUN_COMMANDS = ["discover", "sync", "model", "doctor", "lineage"] as const;

export type SkipprPipelineRunCommand = (typeof SKIPPR_PIPELINE_RUN_COMMANDS)[number];

export function isSkipprPipelineRunCommand(value: unknown): value is SkipprPipelineRunCommand {
  return (
    typeof value === "string" &&
    (SKIPPR_PIPELINE_RUN_COMMANDS as readonly string[]).includes(value)
  );
}
