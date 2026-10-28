import { isSkipprPipelineRunCommand, type SkipprPipelineRunCommand } from "./skipprPipelineRunContext.js";

const discover: SkipprPipelineRunCommand = "discover";
void discover;
void isSkipprPipelineRunCommand("sync");

// @ts-expect-error only SkipprPipelineRunCommand is assignable
const invalid: SkipprPipelineRunCommand = "pick";
void invalid;
