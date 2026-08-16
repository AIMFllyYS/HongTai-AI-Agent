import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

import { diagnosisSinglePrompt, diagnosisSingleRepairPrompt } from "../packages/ai/src/prompts/diagnosis-report-single";
import { diagnosisConversationPrompt } from "../packages/ai/src/prompts/diagnosis-conversation";
import { FIVE_ORGANS_OBSERVATION_KNOWLEDGE } from "../packages/ai/src/knowledge/five-organs-observation.generated";
import { diagnosisFollowUpReplySchema } from "../packages/ai/src/schemas/diagnosis-follow-up";
import {
  diagnosisReportSchema,
  diagnosisSingleResponseSchema,
  diagnosisWellnessRecommendationsSchema,
} from "../packages/ai/src/schemas/diagnosis-report";

const root = resolve(import.meta.dirname, "..");
// 与生成脚本一致地归一化为 LF：注入 Prompt 的内容不得随检出平台的行尾转换而变化。
const markdown = readFileSync(resolve(root, "packages/ai/src/knowledge/five-organs-observation.md"), "utf8").replace(/\r\n/gu, "\n");

test("五脏六腑观察知识库以独立 Markdown 为唯一权威并完整注入诊察 Prompt", () => {
  assert.equal(FIVE_ORGANS_OBSERVATION_KNOWLEDGE, markdown);
  assert.ok(markdown.length >= 4_000 && markdown.length <= 10_000, `知识库长度应为4千到1万字，当前${markdown.length}`);
  assert.match(markdown, /齿痕/u);
  assert.match(markdown, /白苔/u);
  assert.match(markdown, /舌红/u);
  assert.match(markdown, /五脏六腑/u);
  assert.match(markdown, /四诊合参/u);
  assert.match(markdown, /不能据此诊断/u);
  assert.match(markdown, /https:\/\//u);

  const tonguePrompt = diagnosisSinglePrompt("tongue");
  const facePrompt = diagnosisSinglePrompt("face");
  assert.match(tonguePrompt, /以下Markdown只约束五脏六腑/u);
  assert.ok(tonguePrompt.includes(markdown));
  assert.ok(facePrompt.includes(markdown));
  assert.equal(tonguePrompt.split(markdown).length, 2, "知识库只注入一次");
  assert.match(tonguePrompt, /单一齿痕、白苔或舌红直接等同于湿气重、胃寒或心火旺/u);
  assert.match(tonguePrompt, /wellnessReferences/u);
  assert.match(tonguePrompt, /舌诊专属观察重点/u);
  assert.doesNotMatch(tonguePrompt, /面诊专属观察重点/u);
  assert.match(facePrompt, /面诊专属观察重点/u);
  assert.doesNotMatch(facePrompt, /舌诊专属观察重点/u);
  assert.ok(tonguePrompt.indexOf("思考基础规范") < tonguePrompt.indexOf("舌诊专属观察重点"));
  assert.ok(tonguePrompt.indexOf("舌诊专属观察重点") < tonguePrompt.indexOf(markdown));
  assert.ok(tonguePrompt.indexOf(markdown) < tonguePrompt.indexOf("最高优先级再次确认"));
  assert.doesNotMatch(tonguePrompt, /\$schema|additionalProperties|definitions/u);
  assert.match(tonguePrompt, /不得讨论JSON字段、括号、引号、转义、Schema、格式修复或Token/u);

  const repairPrompt = diagnosisSingleRepairPrompt("不是JSON", "tongue");
  assert.doesNotMatch(repairPrompt, /全国标准信息公共服务平台|五脏六腑观察知识库/u);
  assert.match(repairPrompt, /八个字段齐全/u);
});

test("紧凑诊察响应只允许把传统关联作为不确定的日常参考", () => {
  const valid = diagnosisSingleResponseSchema.safeParse({
    quality: "good",
    qualityNote: "目标完整清晰。",
    observations: [
      { category: "tongue_shape", region: "舌边", label: "浅齿痕", description: "舌边可见数处浅齿痕。" },
      { category: "tongue_body", region: "舌体", label: "形态", description: "舌体在画面中略显胖。" },
      { category: "tongue_coating", region: "舌中", label: "薄白苔", description: "舌中可见薄白苔。" },
    ],
    summary: "当前图片可用于记录舌形变化。",
    wellnessReferences: [{ title: "传统观察方向", statement: "传统观察中，这组特征可能与脾气不足、津液运化失常一类状态同时出现。" }],
    advice: "在相同光线下记录变化，如有持续不适请咨询专业人员。",
    safety: "这不是疾病诊断，也不能替代四诊合参。",
    followUp: "近期是否同时有食欲、腹胀或大便变化？",
  });
  assert.equal(valid.success, true);

  const unusable = diagnosisSingleResponseSchema.safeParse({
    quality: "unusable",
    qualityNote: "图片严重失焦。",
    observations: [],
    summary: "图片不可用。",
    wellnessReferences: [{ title: "错误结论", statement: "可能是湿气重。" }],
    advice: "",
    safety: "请重新拍摄。",
    followUp: "",
  });
  assert.equal(unusable.success, false);

  const overconfident = diagnosisSingleResponseSchema.safeParse({
    quality: "good",
    qualityNote: "目标清晰。",
    observations: [
      { category: "tongue_shape", region: "舌边", label: "齿痕", description: "舌边可见齿痕。" },
      { category: "tongue_body", region: "舌体", label: "颜色", description: "舌体颜色可辨。" },
      { category: "tongue_coating", region: "舌中", label: "舌苔", description: "舌苔分布可辨。" },
    ],
    summary: "记录舌形。",
    wellnessReferences: [{ title: "错误结论", statement: "齿痕说明湿气重。" }],
    advice: "保持相同光线记录。",
    safety: "如有不适请咨询专业人员。",
    followUp: "",
  });
  assert.equal(overconfident.success, false);
});

const compactBase = {
  quality: "good" as const,
  qualityNote: "目标完整清晰。",
  observations: [
    { category: "tongue_shape" as const, region: "舌边", label: "浅齿痕", description: "舌边可见数处浅齿痕。" },
    { category: "tongue_body" as const, region: "舌体", label: "形态", description: "舌体在画面中略显胖。" },
    { category: "tongue_coating" as const, region: "舌中", label: "薄白苔", description: "舌中可见薄白苔。" },
  ],
  summary: "当前图片可用于记录舌形变化。",
  advice: "在相同光线下记录变化，如有持续不适请咨询专业人员。",
  safety: "这不是疾病诊断，也不能替代四诊合参。",
  followUp: "近期是否同时有食欲、腹胀或大便变化？",
};

const assembledWellnessBase = {
  wellnessReferences: [{
    title: "传统观察方向",
    basisObservationIds: ["obs-1"],
    statement: "传统观察中，这组特征可能与脾气不足、津液运化失常一类状态同时出现；单张图片不能据此诊断。",
    certainty: "uncertain" as const,
    notADiagnosis: true as const,
  }],
  recommendations: [{
    category: "monitoring" as const,
    priority: "low" as const,
    title: "日常记录建议",
    action: "保持相同光线定期记录，并结合近期作息观察变化。",
    rationale: "基于本次图片中已确认的可见状态，建议只用于日常记录和变化比较。",
    relatedObservationIds: ["obs-1"],
  }],
};

test("紧凑响应与组装板块拦截确诊、概率、处方和健康评分，不误杀不确定参考", () => {
  const traditional = diagnosisSingleResponseSchema.safeParse({
    ...compactBase,
    wellnessReferences: [{ title: "传统观察方向", statement: "传统观察中，这组特征可能与脾气不足、津液运化失常一类状态同时出现。" }],
  });
  assert.equal(traditional.success, true);

  const knowledgeDisclaimer = diagnosisSingleResponseSchema.safeParse({
    ...compactBase,
    wellnessReferences: [{
      title: "传统观察方向",
      statement: "传统分区中舌尖与心肺相关，舌尖偏红有时会被用于询问心烦、睡眠、口舌不适等情况；不能据此判断心脏疾病或确诊心火旺",
    }],
  });
  assert.equal(knowledgeDisclaimer.success, true);

  const assembled = diagnosisWellnessRecommendationsSchema.safeParse(assembledWellnessBase);
  assert.equal(assembled.success, true);

  const diagnosisClaim = diagnosisSingleResponseSchema.safeParse({
    ...compactBase,
    wellnessReferences: [{ title: "错误结论", statement: "可能确诊为糖尿病，患病概率80%。" }],
  });
  assert.equal(diagnosisClaim.success, false);

  const prescriptionAdvice = diagnosisSingleResponseSchema.safeParse({
    ...compactBase,
    wellnessReferences: [{ title: "传统观察方向", statement: "传统观察中，这组特征可能作为日常记录线索。" }],
    advice: "建议按处方服用，每次500mg。",
  });
  assert.equal(prescriptionAdvice.success, false);

  const healthScore = diagnosisWellnessRecommendationsSchema.safeParse({
    ...assembledWellnessBase,
    wellnessReferences: [{
      ...assembledWellnessBase.wellnessReferences[0]!,
      statement: "可能健康评分为90；单张图片不能据此诊断。",
    }],
  });
  assert.equal(healthScore.success, false);

  const reportOverreach = diagnosisReportSchema.safeParse({
    schemaVersion: "diagnosis-report.v1",
    mode: "tongue",
    promptVersion: "diagnosis-single-stream.v3",
    imageQuality: { usable: true, overallQuality: "good", limitations: [], retakeSuggestions: [] },
    observations: [{
      id: "obs-1",
      category: "tongue_body",
      region: "舌体",
      label: "颜色",
      description: "颜色较均匀",
      visibility: "clear",
      evidenceDescription: "舌体区域清晰",
    }],
    summary: { headline: "舌象清晰可观察", keyPoints: ["舌体颜色较均匀"], narrative: "本结果仅提供可见状态观察参考。" },
    ...assembledWellnessBase,
    wellnessReferences: [{
      ...assembledWellnessBase.wellnessReferences[0]!,
      statement: "可能诊断为脾虚，患病概率80%；单张图片不能据此诊断。",
    }],
    safetyGuidance: { level: "none", reasons: [], recommendedAction: "如有持续不适请咨询专业人员。" },
    limitations: ["单张图片不能替代专业检查。"],
    disclaimer: "本报告仅提供图片中可见状态的日常观察参考，不是疾病诊断，不提供患病概率，也不能替代专业检查。",
    followUpQuestions: [],
  });
  assert.equal(reportOverreach.success, false);
});

test("清晰、有限和不可用图片遵守各自的观察数量边界", () => {
  const base = {
    summary: "图片可用于记录。",
    wellnessReferences: [],
    advice: "保持相同条件记录。",
    safety: "单张图片不能替代专业检查。",
    followUp: "",
  };
  const observation = { category: "facial_color" as const, region: "面部", label: "色泽", description: "整体色泽可辨。" };
  assert.equal(diagnosisSingleResponseSchema.safeParse({ ...base, quality: "good", qualityNote: "清晰。", observations: [observation, observation, observation] }).success, true);
  assert.equal(diagnosisSingleResponseSchema.safeParse({ ...base, quality: "good", qualityNote: "清晰。", observations: [observation, observation] }).success, false);
  assert.equal(diagnosisSingleResponseSchema.safeParse({ ...base, quality: "limited", qualityNote: "略偏暗但可辨。", observations: [observation] }).success, true);
  assert.equal(diagnosisSingleResponseSchema.safeParse({ ...base, quality: "limited", qualityNote: "略偏暗但可辨。", observations: [] }).success, false);
});

test("追问回复复用报告级结构越界，拦截无「为」的概率和评分", () => {
  assert.equal(diagnosisFollowUpReplySchema.safeParse("建议结合规律作息继续观察。").success, true);
  assert.equal(diagnosisFollowUpReplySchema.safeParse("患病概率80%").success, false);
  assert.equal(diagnosisFollowUpReplySchema.safeParse("健康评分90").success, false);
});

test("后续对话只继承安全边界而不继承JSON输出约束", () => {
  const prompt = diagnosisConversationPrompt({
    schemaVersion: "diagnosis-report.v1",
    mode: "face",
    promptVersion: "diagnosis-single-stream.v3",
    imageQuality: { usable: true, overallQuality: "good", limitations: [], retakeSuggestions: [] },
    observations: [{ id: "obs-1", category: "facial_color", region: "面部", label: "色泽", description: "色泽较均匀", visibility: "clear", evidenceDescription: "色泽较均匀" }],
    summary: { headline: "面部可见状态摘要", keyPoints: ["色泽较均匀"], narrative: "用于日常记录。" },
    wellnessReferences: [],
    recommendations: [],
    safetyGuidance: { level: "none", reasons: [], recommendedAction: "如有持续不适请咨询专业人员。" },
    limitations: ["单张图片不能替代专业检查。"],
    disclaimer: "本报告不是疾病诊断。",
    followUpQuestions: [],
  });
  assert.match(prompt, /回复自然中文文本，不输出JSON/u);
  assert.doesNotMatch(prompt, /八个顶层字段|最终结果只输出一个JSON对象/u);
});
