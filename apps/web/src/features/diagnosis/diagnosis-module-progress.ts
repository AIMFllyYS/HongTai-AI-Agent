import type { JsonObject } from "@hongtai/core";

import {
  nonEmpty,
  readObject,
  readObjects,
  readString,
  readStrings,
  type ValidatedModuleContent,
  type ValidatedModuleDefinition,
} from "../generation/validated-module-progress";

function qualityLabel(quality: string | undefined, usable: boolean | undefined): string {
  if (usable === false || quality === "unusable") return "当前图片不可用于可靠观察";
  if (quality === "good") return "图片清晰，可进行可见观察";
  return "图片存在限制，仅展示能够确认的部分";
}

function observationLine(value: JsonObject): string | undefined {
  const heading = nonEmpty([readString(value, "region"), readString(value, "label")]).join(" · ");
  const description = readString(value, "description");
  if (!heading && !description) return undefined;
  return heading && description ? `${heading}：${description}` : heading || description;
}

function referenceLine(value: JsonObject): string | undefined {
  const title = readString(value, "title");
  const statement = readString(value, "statement");
  return title && statement ? `${title}：${statement}` : title || statement;
}

function recommendationLine(value: JsonObject): string | undefined {
  const title = readString(value, "title");
  const action = readString(value, "action");
  return title && action ? `${title}：${action}` : title || action;
}

function visualObservations(result: JsonObject): ValidatedModuleContent {
  const imageQuality = readObject(result, "imageQuality");
  const usable = typeof imageQuality?.usable === "boolean" ? imageQuality.usable : undefined;
  const quality = readString(imageQuality, "overallQuality");
  const observations = readObjects(result, "observations").flatMap((value) => {
    const line = observationLine(value);
    return line ? [line] : [];
  });
  const limitations = readStrings(imageQuality, "limitations");
  const retake = readStrings(imageQuality, "retakeSuggestions");
  return {
    lead: qualityLabel(quality, usable),
    facts: [{ label: "已校验观察", value: `${observations.length} 项` }],
    groups: [
      { title: "图片可见观察", items: observations.length ? observations : ["当前图片没有可安全展示的观察项。"] },
      ...(limitations.length ? [{ title: "图片限制", items: limitations }] : []),
      ...(retake.length ? [{ title: "重拍建议", items: retake }] : []),
    ],
  };
}

function observationSummary(result: JsonObject): ValidatedModuleContent {
  const summary = readObject(result, "summary");
  const keyPoints = readStrings(summary, "keyPoints");
  return {
    lead: readString(summary, "headline"),
    groups: keyPoints.length ? [{ title: "可见要点", items: keyPoints }] : [],
    note: readString(summary, "narrative"),
  };
}

function wellnessRecommendations(result: JsonObject): ValidatedModuleContent {
  const references = readObjects(result, "wellnessReferences").flatMap((value) => {
    const line = referenceLine(value);
    return line ? [line] : [];
  });
  const recommendations = readObjects(result, "recommendations").flatMap((value) => {
    const line = recommendationLine(value);
    return line ? [line] : [];
  });
  return {
    lead: references.length || recommendations.length
      ? "已根据前序可见观察生成日常参考。"
      : "当前图片没有足够依据生成日常参考。",
    groups: [
      ...(references.length ? [{ title: "日常参考", items: references }] : []),
      ...(recommendations.length ? [{ title: "行动建议", items: recommendations }] : []),
    ],
  };
}

function safetyLimitations(result: JsonObject): ValidatedModuleContent {
  const safety = readObject(result, "safetyGuidance");
  const reasons = readStrings(safety, "reasons");
  const limitations = readStrings(result, "limitations");
  return {
    lead: readString(safety, "recommendedAction"),
    groups: [
      ...(reasons.length ? [{ title: "安全提醒", items: reasons }] : []),
      { title: "观察局限", items: limitations.length ? limitations : ["单张图片存在观察局限。"] },
    ],
    note: readString(result, "disclaimer"),
  };
}

function followUpQuestions(result: JsonObject): ValidatedModuleContent {
  const questions = readStrings(result, "followUpQuestions");
  return {
    lead: questions.length ? "可继续围绕以下问题了解日常记录方式。" : "当前报告暂不需要额外追问。",
    groups: questions.length ? [{ title: "建议追问", items: questions }] : [],
  };
}

export const diagnosisModuleDefinitions: readonly ValidatedModuleDefinition[] = [
  { moduleId: "visual-observations", title: "可见观察", runningLabel: "正在分析图片中的可见信息", validatingLabel: "正在校验图片质量与观察项", present: visualObservations },
  { moduleId: "observation-summary", title: "观察摘要", runningLabel: "正在整理观察摘要", validatingLabel: "正在校验摘要与可见观察的一致性", present: observationSummary },
  { moduleId: "wellness-recommendations", title: "日常参考与建议", runningLabel: "正在生成日常参考", validatingLabel: "正在核对建议引用的观察依据", present: wellnessRecommendations },
  { moduleId: "safety-limitations", title: "安全提醒与局限", runningLabel: "正在生成安全提醒", validatingLabel: "正在校验限制说明与免责声明", present: safetyLimitations },
  { moduleId: "follow-up-questions", title: "后续追问", runningLabel: "正在生成必要追问", validatingLabel: "正在校验追问内容", present: followUpQuestions },
] as const;
