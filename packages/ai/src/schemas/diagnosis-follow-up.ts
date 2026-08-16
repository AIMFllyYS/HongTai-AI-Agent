import { z } from "zod";

export const DIAGNOSIS_FOLLOW_UP_MAX_CHARS = 2_000;
export const DIAGNOSIS_FOLLOW_UP_MAX_OUTPUT_TOKENS = 1_024;

/** 与五脏六腑观察知识库「禁用句式」对齐，禁止诊断、处方、概率和整体健康评分。 */
const FORBIDDEN_FOLLOW_UP_PATTERNS: readonly RegExp[] = [
  /你就是(?:湿气重|胃寒|心火旺)/u,
  /你的(?:肝|心|脾|肺|肾)(?:[、，,](?:肝|心|脾|肺|肾))*有问题/u,
  /准确率为/u,
  /患病概率为/u,
  /健康评分为/u,
  /已经确诊/u,
  /确诊为/u,
  /诊断为/u,
  /根据这张(?:脸|舌头|舌象|面部).{0,20}确诊/u,
  /处方/u,
  /开药/u,
  /停药/u,
  /替代就医/u,
  /建议服用/u,
  /\d+\s*(?:mg|毫克)/iu,
];

export function diagnosisFollowUpViolatesMedicalBoundary(text: string): boolean {
  return FORBIDDEN_FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(text));
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
