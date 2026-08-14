import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

import { diagnosisSinglePrompt } from "../packages/ai/src/prompts/diagnosis-report-single";
import { FIVE_ORGANS_OBSERVATION_KNOWLEDGE } from "../packages/ai/src/knowledge/five-organs-observation.generated";
import { diagnosisSingleResponseSchema } from "../packages/ai/src/schemas/diagnosis-report";

const root = resolve(import.meta.dirname, "..");
const markdown = readFileSync(resolve(root, "packages/ai/src/knowledge/five-organs-observation.md"), "utf8");

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
  assert.match(tonguePrompt, /以下 Markdown 是本次唯一允许使用的传统观察知识上下文/u);
  assert.ok(tonguePrompt.includes(markdown));
  assert.ok(facePrompt.includes(markdown));
  assert.match(tonguePrompt, /不能把齿痕直接等同于湿气重/u);
  assert.match(tonguePrompt, /wellnessReference/u);
});

test("紧凑诊察响应只允许把传统关联作为不确定的日常参考", () => {
  const valid = diagnosisSingleResponseSchema.safeParse({
    quality: "good",
    observation: "舌边可见浅齿痕，舌体略显胖。",
    summary: "当前图片可用于记录舌形变化。",
    wellnessReference: "传统观察中，这组可见特征可能与脾气不足、津液运化失常一类状态同时出现；单张图片不能据此诊断。",
    advice: "在相同光线下记录变化，如有持续不适请咨询专业人员。",
    safety: "这不是疾病诊断，也不能替代四诊合参。",
    followUp: "近期是否同时有食欲、腹胀或大便变化？",
  });
  assert.equal(valid.success, true);

  const unusable = diagnosisSingleResponseSchema.safeParse({
    quality: "unusable",
    observation: "",
    summary: "图片不可用。",
    wellnessReference: "湿气重。",
    advice: "",
    safety: "请重新拍摄。",
    followUp: "",
  });
  assert.equal(unusable.success, false);

  const overconfident = diagnosisSingleResponseSchema.safeParse({
    quality: "good",
    observation: "舌边可见齿痕。",
    summary: "记录舌形。",
    wellnessReference: "齿痕说明湿气重。",
    advice: "保持相同光线记录。",
    safety: "如有不适请咨询专业人员。",
    followUp: "",
  });
  assert.equal(overconfident.success, false);
});
