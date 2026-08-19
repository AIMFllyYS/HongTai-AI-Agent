import { TaskError } from "@hongtai/core";

/**
 * A provider that refuses the vision model reads as a permission problem, but the fix is not "ask
 * for permission" — it is picking a connection that has a vision model at all. Both callers that
 * send images need the same translation, so the mapping lives here rather than in each flow.
 */
export function visionUnavailable(error: unknown): unknown {
  return error instanceof TaskError && error.code === "AI_PERMISSION_DENIED"
    ? new TaskError({ code: "AI_VISION_UNAVAILABLE", message: "当前AI连接没有可用的视觉模型能力", action: "configure_ai", cause: error })
    : error;
}
