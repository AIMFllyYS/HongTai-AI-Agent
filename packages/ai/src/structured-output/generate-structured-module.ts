import { TaskError } from "@hongtai/core";
import type { ZodType } from "zod";

import type { AiGenerateRequest, AiGenerateResult, AiProvider } from "../contracts/provider";
import { parseStructuredOutput } from "./parse-structured-output";

export interface StructuredModuleAttempt {
  readonly result: AiGenerateResult;
  readonly repaired: boolean;
}

export interface GenerateStructuredModuleOptions<T> {
  readonly provider: AiProvider;
  readonly request: AiGenerateRequest;
  readonly schema: ZodType<T>;
  readonly repairPrompt: (raw: string) => string;
  readonly validate?: (value: T) => void;
  readonly onRepairing?: () => void | Promise<void>;
  readonly onValidating?: (repairing: boolean) => void | Promise<void>;
  readonly onFailed?: () => void | Promise<void>;
  readonly onAttempt?: (attempt: StructuredModuleAttempt) => void | Promise<void>;
  readonly mapInitialError?: (error: unknown) => unknown;
  readonly failureMessage: string;
}

function validateModule<T>(content: string, schema: ZodType<T>, validate?: (value: T) => void): T {
  const value = parseStructuredOutput(content, schema);
  validate?.(value);
  return value;
}

/**
 * Generates one bounded structured module. It has exactly one normal attempt
 * and at most one repair attempt; orchestration and module ordering remain in
 * the two concrete flows.
 */
export async function generateStructuredModule<T>(
  options: GenerateStructuredModuleOptions<T>,
): Promise<T> {
  try {
    let initial: AiGenerateResult;
    try {
      initial = await options.provider.generate(options.request);
    } catch (error) {
      throw options.mapInitialError?.(error) ?? error;
    }
    await options.onAttempt?.({ result: initial, repaired: false });
    try {
      await options.onValidating?.(false);
      return validateModule(initial.content, options.schema, options.validate);
    } catch (error) {
      if (!(error instanceof TaskError) || error.code !== "AI_STRUCTURED_OUTPUT_INVALID") throw error;
    }

    await options.onRepairing?.();
    const repaired = await options.provider.generate({
      ...options.request,
      model: "text",
      messages: [{ role: "system", content: options.repairPrompt(initial.content) }],
    });
    await options.onAttempt?.({ result: repaired, repaired: true });
    try {
      await options.onValidating?.(true);
      return validateModule(repaired.content, options.schema, options.validate);
    } catch (repairError) {
      throw new TaskError({
        code: "AI_FORMAT_REPAIR_FAILED",
        message: options.failureMessage,
        action: "retry",
        cause: repairError,
      });
    }
  } catch (error) {
    await options.onFailed?.();
    throw error;
  }
}
