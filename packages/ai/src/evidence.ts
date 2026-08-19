import { TaskError } from "@hongtai/core";

import type { ContentEvidenceUnit } from "./contracts/content-analysis";

/**
 * Every document derived from a source video may only point at evidence that was actually in the
 * input. Zod can check that a reference is a non-empty string but not that it exists, and a model
 * inventing `seg-9` is exactly how a fabricated claim gets a citation that looks real.
 *
 * Shared so the analysis and the blueprint enforce one rule: a second copy would drift, and the
 * repair round would keep whichever copy is looser.
 */
export function assertEvidenceRefs(input: {
  readonly references: readonly string[];
  readonly units: readonly ContentEvidenceUnit[];
  readonly message: string;
}): void {
  const valid = new Set(input.units.map((unit) => unit.id));
  if (input.references.some((id) => !valid.has(id))) {
    throw new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message: input.message, action: "retry" });
  }
}
