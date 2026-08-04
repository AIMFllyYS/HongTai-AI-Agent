import type { TaskStage } from "./models";

export const PIPELINE_STAGES = [
  "detect-platform",
  "resolve-link",
  "parse-content",
  "select-media",
  "download-media",
  "obtain-transcript",
  "save-artifacts",
] as const satisfies readonly TaskStage[];

