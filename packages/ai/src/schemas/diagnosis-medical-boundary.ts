import type { RefinementCtx } from "zod";

/**
 * 结构型越界声明：肯定确诊声明、诊断为、概率+数字或%、处方/用药剂量、健康评分。
 * 确诊只拦「确诊为 / 已经确诊 / 根据这张…确诊」，不裸匹配「确诊」，以免误杀知识库否定/免责句。
 * 不维护疾病名词典，也不把「可能/有时/不确定」等缓和词当作已审查。
 */
const STRUCTURAL_OVERREACH_PATTERNS: readonly RegExp[] = [
  /已经确诊/u,
  /确诊为/u,
  /根据这张(?:脸|舌头|舌象|面部).{0,20}确诊/u,
  /诊断为/u,
  /概率(?=[^。；\n]{0,24}(?:\d|%|％|百分之))/u,
  /(?:\d|%|％|百分之)(?=[^。；\n]{0,24}概率)/u,
  /处方/u,
  /用药剂量/u,
  /\d+\s*(?:mg|毫克)/iu,
  /健康评分/u,
];

export function diagnosisTextHasStructuralOverreach(text: string): boolean {
  return STRUCTURAL_OVERREACH_PATTERNS.some((pattern) => pattern.test(text));
}

export function rejectDiagnosisStructuralOverreach(value: string, context: RefinementCtx): void {
  if (value.length > 0 && diagnosisTextHasStructuralOverreach(value)) {
    context.addIssue({
      code: "custom",
      message: "观察参考不得包含确诊、诊断为、概率数值、处方、用药剂量或健康评分",
    });
  }
}
