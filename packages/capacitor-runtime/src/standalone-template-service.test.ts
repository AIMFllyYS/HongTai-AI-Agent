import assert from "node:assert/strict";
import test from "node:test";

import { TaskError } from "@hongtai/core";
import type { ContentAnalysisRecord, LinkedRecordDeleteOptions } from "@hongtai/core";

import { StandaloneTemplateService } from "./standalone-template-service.js";

const analysis: ContentAnalysisRecord = {
  taskId: "task-1",
  status: "succeeded",
  result: {
    schemaVersion: "content-analysis.v1",
    document: {
      schemaVersion: "content-analysis.v1",
      source: { taskId: "task-1", platform: "local_upload", contentType: "video", sourceKind: "asr" },
      overview: { summary: "  真实内容摘要  ", theme: " 门店口播 ", targetAudiences: [], communicationGoal: "介绍服务" },
      hook: { type: "pain_point", description: "痛点", mechanism: "共鸣", evidenceRefs: [] },
      painPoints: [], emotionalDrivers: [], structure: [], coreClaims: [],
      style: { tones: [], pacing: "紧凑", languagePatterns: [], interactionMechanisms: [] },
      reusableTemplate: { formula: " 痛点-方法-行动 ", steps: [" 提出问题 ", " 给出方法 "], variableSlots: [" 行业痛点 "], doNotCopy: [] },
      risks: [],
    },
  },
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
};

function harness() {
  const values = new Map<string, string>();
  const ids = new Set<string>();
  let nextTemplateId = 0;
  const files = {
    ensureTemplate: async ({ templateId }: { readonly templateId: string }) => { ids.add(templateId); },
    writeTemplateText: async ({ templateId, relativePath, value }: { readonly templateId: string; readonly relativePath: string; readonly value: string; readonly replace: boolean }) => { values.set(`${templateId}/${relativePath}`, value); },
    readTemplateText: async ({ templateId, relativePath }: { readonly templateId: string; readonly relativePath: string }) => ({ value: values.get(`${templateId}/${relativePath}`) }),
    listTemplateIds: async () => ({ templateIds: [...ids] }),
    deleteTemplate: async ({ templateId }: { readonly templateId: string }) => {
      ids.delete(templateId);
      for (const path of [...values.keys()]) if (path.startsWith(`${templateId}/`)) values.delete(path);
    },
  };
  const create = (extra?: {
    readonly deleteTaskCascade?: (taskId: string, options?: LinkedRecordDeleteOptions) => Promise<void>;
  }) => new StandaloneTemplateService({
    files,
    analysis: { get: async () => analysis },
    createTemplateId: () => `template-${++nextTemplateId}`,
    now: () => new Date("2026-08-08T00:00:00.000Z"),
    ...extra,
  });
  return { create, values };
}

test("模板可从正式拆解复制、编辑、重启恢复并真实删除", async () => {
  const { create, values } = harness();
  const service = create();
  const imported = await service.createFromAnalysis("task-1");
  assert.equal(imported.name, "门店口播");
  assert.equal(imported.summary, "真实内容摘要");
  assert.equal(imported.formula, "痛点-方法-行动");
  assert.deepEqual(imported.steps, ["提出问题", "给出方法"]);
  assert.equal(values.get("template-1/template.json")?.includes("reasoning"), false);

  const updated = await service.update("template-1", {
    name: " 自定义模板 ", summary: " 自定义摘要 ", formula: " 开场-证据-行动 ", steps: [" 开场 "], variableSlots: [" 产品名 "],
  });
  assert.equal(updated.name, "自定义模板");
  assert.equal((await create().get("template-1"))?.formula, "开场-证据-行动");
  assert.equal((await create().list()).length, 1);

  await service.delete("template-1");
  assert.equal(await service.get("template-1"), undefined);
});

test("模板支持纯自定义并拒绝越界内容", async () => {
  const { create } = harness();
  const service = create();
  const custom = await service.create({ name: "自定义", summary: "", formula: "", steps: [], variableSlots: [] });
  assert.equal(custom.sourceTaskId, undefined);
  await assert.rejects(() => service.update(custom.templateId, { name: "x".repeat(81), summary: "", formula: "", steps: [], variableSlots: [] }), /80/u);
  await assert.rejects(() => service.create({ name: "越界", summary: "", formula: "", steps: Array.from({ length: 41 }, () => "步骤"), variableSlots: [] }), /40/u);
});

test("有来源任务的模板删除委托组合根级联，不自行删除记录", async () => {
  const { create } = harness();
  const cascades: string[] = [];
  const service = create({
    deleteTaskCascade: async (taskId, options) => { cascades.push(`${taskId}:${options?.keepLocalVideo === true}`); },
  });
  const imported = await service.createFromAnalysis("task-1");
  assert.equal(imported.sourceTaskId, "task-1");

  await service.delete(imported.templateId, { keepLocalVideo: true });
  assert.deepEqual(cascades, ["task-1:true"]);
  // 记录级删除由任务侧级联回调完成；纯服务单测没有装配该回路，记录仍在。
  assert.notEqual(await service.get(imported.templateId), undefined);
});

test("来源任务已缺失的悬挂模板删除退化为只删记录", async () => {
  const { create } = harness();
  const service = create({
    deleteTaskCascade: async () => {
      throw new TaskError({ code: "TASK_ARTIFACT_MISSING", message: "未找到要删除的本地任务", action: "none" });
    },
  });
  const imported = await service.createFromAnalysis("task-1");

  await service.delete(imported.templateId);
  assert.equal(await service.get(imported.templateId), undefined);
});

test("级联删除的其它失败原样透出且模板保留", async () => {
  const { create } = harness();
  const service = create({
    deleteTaskCascade: async () => {
      throw new TaskError({ code: "TASK_INTERRUPTED", message: "任务尚未完成，不能删除", action: "wait_and_retry" });
    },
  });
  const imported = await service.createFromAnalysis("task-1");

  await assert.rejects(() => service.delete(imported.templateId), /尚未完成/u);
  assert.notEqual(await service.get(imported.templateId), undefined);
});

test("无来源任务的模板删除不触发级联", async () => {
  const { create } = harness();
  let cascadeCalls = 0;
  const service = create({
    deleteTaskCascade: async () => { cascadeCalls += 1; },
  });
  const custom = await service.create({ name: "自定义", summary: "", formula: "", steps: [], variableSlots: [] });

  await service.delete(custom.templateId);
  assert.equal(cascadeCalls, 0);
  assert.equal(await service.get(custom.templateId), undefined);
});
