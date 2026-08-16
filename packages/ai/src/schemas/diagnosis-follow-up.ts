import { z } from "zod";

import { diagnosisTextHasStructuralOverreach } from "./diagnosis-medical-boundary";

export const DIAGNOSIS_FOLLOW_UP_MAX_CHARS = 2_000;
export const DIAGNOSIS_FOLLOW_UP_MAX_OUTPUT_TOKENS = 1_024;

export function diagnosisFollowUpViolatesMedicalBoundary(text: string): boolean {
  return diagnosisTextHasStructuralOverreach(text);
}

export const diagnosisFollowUpReplySchema = z
  .string()
  .trim()
  .min(1)
  .max(DIAGNOSIS_FOLLOW_UP_MAX_CHARS)
  .superRefine((value, context) => {
    if (diagnosisFollowUpViolatesMedicalBoundary(value)) {
      context.addIssue({ code: "custom", message: "追问回复超出日常观察参考边界" });
    }
  });
