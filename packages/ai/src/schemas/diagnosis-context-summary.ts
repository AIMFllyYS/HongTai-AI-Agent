import { z } from "zod";

export const DIAGNOSIS_CONTEXT_SUMMARY_MAX_CHARS = 2_000;

export const diagnosisContextSummarySchema = z
  .string()
  .trim()
  .min(1)
  .max(DIAGNOSIS_CONTEXT_SUMMARY_MAX_CHARS);
