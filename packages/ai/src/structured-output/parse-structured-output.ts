import { TaskError } from "@hongtai/core";
import type { ZodType } from "zod";

export function parseStructuredOutput<T>(text: string, schema: ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
  } catch (error) {
    throw new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message: "AI返回内容不是有效JSON", action: "retry", cause: error });
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new TaskError({
      code: "AI_STRUCTURED_OUTPUT_INVALID",
      message: "AI返回JSON不符合业务Schema",
      action: "retry",
      details: { issueCount: result.error.issues.length },
      cause: result.error,
    });
  }
  return result.data;
}
