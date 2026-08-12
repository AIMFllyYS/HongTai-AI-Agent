import type { JsonObject } from "@hongtai/core";

import {
  nonEmpty,
  readNumber,
  readObject,
  readObjects,
  readString,
  readStrings,
  type ValidatedModuleContent,
  type ValidatedModuleDefinition,
} from "../generation/validated-module-progress";

function overview(result: JsonObject): ValidatedModuleContent {
  const value = readObject(result, "overview");
  const audiences = readStrings(value, "targetAudiences");
  return {
    lead: readString(value, "summary"),
    facts: [
      ...(readString(value, "theme") ? [{ label: "主题", value: readString(value, "theme") as string }] : []),
      ...(readString(value, "communicationGoal") ? [{ label: "表达目标", value: readString(value, "communicationGoal") as string }] : []),
      ...(audiences.length ? [{ label: "目标受众", value: audiences.join("、") }] : []),
    ],
  };
}

function descriptionLine(value: JsonObject): string | undefined {
  return readString(value, "description");
}

function hookDrivers(result: JsonObject): ValidatedModuleContent {
  const hook = readObject(result, "hook");
  const painPoints = readObjects(result, "painPoints").flatMap((value) => {
    const line = descriptionLine(value);
    return line ? [line] : [];
  });
  const drivers = readObjects(result, "emotionalDrivers").flatMap((value) => {
    const line = descriptionLine(value);
    return line ? [line] : [];
  });
  return {
    lead: readString(hook, "description"),
    facts: readString(hook, "mechanism") ? [{ label: "开场机制", value: readString(hook, "mechanism") as string }] : [],
    groups: [
      ...(painPoints.length ? [{ title: "痛点", items: painPoints }] : []),
      ...(drivers.length ? [{ title: "情绪驱动", items: drivers }] : []),
    ],
  };
}

function structureClaims(result: JsonObject): ValidatedModuleContent {
  const structure = readObjects(result, "structure").flatMap((value) => {
    const summary = readString(value, "summary");
    if (!summary) return [];
    const order = readNumber(value, "order");
    return [order === undefined ? summary : `第 ${order} 段：${summary}`];
  });
  const claims = readObjects(result, "coreClaims").flatMap((value) => {
    const claim = readString(value, "claim");
    if (!claim) return [];
    return [`${readString(value, "supportLevel") === "inferred" ? "推断" : "明确证据"}：${claim}`];
  });
  return {
    lead: `已校验 ${structure.length} 个结构段与 ${claims.length} 条核心观点。`,
    groups: [
      ...(structure.length ? [{ title: "内容结构", items: structure }] : []),
      ...(claims.length ? [{ title: "核心观点", items: claims }] : []),
    ],
  };
}

function styleTemplate(result: JsonObject): ValidatedModuleContent {
  const style = readObject(result, "style");
  const template = readObject(result, "reusableTemplate");
  const tones = readStrings(style, "tones");
  const patterns = readStrings(style, "languagePatterns");
  const interactions = readStrings(style, "interactionMechanisms");
  const steps = readStrings(template, "steps");
  const boundaries = readStrings(template, "doNotCopy");
  return {
    lead: readString(template, "formula"),
    facts: [
      ...(readString(style, "pacing") ? [{ label: "表达节奏", value: readString(style, "pacing") as string }] : []),
      ...(tones.length ? [{ label: "语气", value: tones.join("、") }] : []),
    ],
    groups: [
      ...(patterns.length ? [{ title: "语言特征", items: patterns }] : []),
      ...(interactions.length ? [{ title: "互动方式", items: interactions }] : []),
      ...(steps.length ? [{ title: "复用步骤", items: steps }] : []),
      ...(boundaries.length ? [{ title: "不要照搬", items: boundaries }] : []),
    ],
  };
}

function risksBoundaries(result: JsonObject): ValidatedModuleContent {
  const risks = readObjects(result, "risks").flatMap((value) => {
    const description = readString(value, "description");
    const suggestion = readString(value, "suggestion");
    const level = readString(value, "level");
    const parts = nonEmpty([
      level ? `${level === "high" ? "高" : level === "medium" ? "中" : "低"}风险` : undefined,
      description,
    ]);
    if (!parts.length) return [];
    return [`${parts.join(" · ")}${suggestion ? `；建议：${suggestion}` : ""}`];
  });
  return {
    lead: risks.length ? `已识别 ${risks.length} 项需要留意的内容边界。` : "未识别到需要单独提示的内容风险。",
    groups: risks.length ? [{ title: "风险与修改建议", items: risks }] : [],
  };
}

export const contentAnalysisModuleDefinitions: readonly ValidatedModuleDefinition[] = [
  { moduleId: "overview", title: "内容概览", runningLabel: "正在生成内容概览", validatingLabel: "正在校验主题、受众与表达目标", present: overview },
  { moduleId: "hook-drivers", title: "开场与情绪驱动", runningLabel: "正在拆解开场与情绪驱动", validatingLabel: "正在核对开场结论的证据引用", present: hookDrivers },
  { moduleId: "structure-claims", title: "结构与核心观点", runningLabel: "正在拆解结构与核心观点", validatingLabel: "正在校验结构与观点的证据引用", present: structureClaims },
  { moduleId: "style-template", title: "表达风格与复用模板", runningLabel: "正在提炼表达风格与模板", validatingLabel: "正在校验模板边界", present: styleTemplate },
  { moduleId: "risks-boundaries", title: "风险与边界", runningLabel: "正在识别风险与边界", validatingLabel: "正在校验风险提示的证据引用", present: risksBoundaries },
] as const;
