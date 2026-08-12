import assert from "node:assert/strict";
import test from "node:test";

import type { AiProvider, ProductionPlanResultV1 } from "@hongtai/ai";
import type { ContentAnalysisRecord } from "@hongtai/core";

import { RuntimeOperationRegistry } from "./runtime-operation-registry.js";
import { StandaloneProductionService } from "./standalone-production-service.js";

const plan: ProductionPlanResultV1 = {
  schemaVersion: "production-plan.v1",
  source: { analysisTaskId: "task-1" },
  title: "门店真实体验",
  settings: { width: 720, height: 1280, fps: 30, durationSeconds: 20 },
  audio: { voiceLocale: "zh-CN", speechRate: 1, backgroundMusicAssetId: null, backgroundMusicVolume: 0 },
  shots: [
    { order: 1, assetId: "asset-1", durationSeconds: 8, narration: "先看看真实环境。", caption: "真实环境", fit: "cover" },
    { order: 2, assetId: "asset-2", durationSeconds: 12, narration: "再了解完整服务过程。", caption: "服务过程", fit: "cover" },
  ],
};

const analysis: ContentAnalysisRecord = {
  taskId: "task-1",
  status: "succeeded",
  result: {
    schemaVersion: "content-analysis.v1",
    document: {
      schemaVersion: "content-analysis.v1",
      source: { taskId: "task-1", platform: "douyin", contentType: "video", sourceKind: "asr" },
      overview: { summary: "展示服务", theme: "门店", targetAudiences: [], communicationGoal: "了解服务" },
      hook: { type: "result", description: "展示结果", mechanism: "建立兴趣", evidenceRefs: [] },
      painPoints: [], emotionalDrivers: [], structure: [], coreClaims: [],
      style: { tones: [], pacing: "紧凑", languagePatterns: [], interactionMechanisms: [] },
      reusableTemplate: { formula: "结果-过程", steps: [], variableSlots: [], doNotCopy: [] }, risks: [],
    },
  },
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
};

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve };
}

function harness() {
  const values = new Map<string, string>();
  const ids = new Set<string>();
  const files = {
    ensureProduction: async ({ projectId }: { readonly projectId: string }) => { ids.add(projectId); },
    writeProductionText: async ({ projectId, relativePath, value }: { readonly projectId: string; readonly relativePath: string; readonly value: string; readonly replace: boolean }) => { values.set(`${projectId}/${relativePath}`, value); },
    readProductionText: async ({ projectId, relativePath }: { readonly projectId: string; readonly relativePath: string }) => ({ value: values.get(`${projectId}/${relativePath}`) }),
    listProductionIds: async () => ({ projectIds: [...ids] }),
  };
  const provider: AiProvider = {
    generate: async () => ({ content: JSON.stringify(plan), reasoning: "" }),
    transcribe: async () => "",
  };
  const native = {
    pickAssets: async () => ({ assets: [
      { id: "asset-1", uri: "file:///private/productions/project-1/inputs/asset-1.jpg", kind: "image" as const, mimeType: "image/jpeg", displayName: "门店.jpg", sizeBytes: 100 },
      { id: "asset-2", uri: "file:///private/productions/project-1/inputs/asset-2.mp4", kind: "video" as const, mimeType: "video/mp4", displayName: "服务.mp4", sizeBytes: 200, durationSeconds: 12 },
      { id: "asset-3", uri: "file:///private/productions/project-1/inputs/asset-3.png", kind: "image" as const, mimeType: "image/png", displayName: "细节.png", sizeBytes: 50 },
    ] }),
    render: async () => ({ uri: "file:///private/productions/project-1/output.mp4", mimeType: "video/mp4" as const, sizeBytes: 1_024, durationSeconds: 20 }),
  };
  const create = () => new StandaloneProductionService({
    files,
    native,
    analysis: { get: async () => analysis, run: async () => analysis },
    getProvider: async () => provider,
    toDisplayUri: (uri: string) => uri.replace("file:///private/", "capacitor://localhost/private/"),
    createProjectId: () => "project-1",
    now: () => new Date("2026-08-08T00:00:00.000Z"),
  });
  return { create, values };
}

test("制作项目导入素材、生成计划和渲染结果后可在重启后恢复", async () => {
  const { create } = harness();
  const service = create();
  await service.create({ analysisTaskId: "task-1", brief: "突出真实服务", targetDurationSeconds: 20 });
  const imported = await service.importAssets("project-1");
  assert.equal(imported.assets.length, 3);

  const ready = await service.generatePlan("project-1");
  assert.equal(ready.status, "ready");
  assert.equal(ready.plan?.schemaVersion, "production-plan.v1");

  const completed = await service.render("project-1");
  assert.equal(completed.status, "succeeded");
  assert.match(completed.output?.uri ?? "", /^capacitor:\/\//u);

  const restored = await create().get("project-1");
  assert.equal(restored?.status, "succeeded");
  assert.equal(restored?.assets[0]?.uri.includes("file://"), false);
  assert.equal((await create().list()).length, 1);
});

test("制作计划失败时保留项目和已导入素材", async () => {
  const { create, values } = harness();
  const service = create();
  await service.create({ analysisTaskId: "task-1", brief: "真实门店", targetDurationSeconds: 20 });
  await service.importAssets("project-1");
  values.set("project-1/project.json", values.get("project-1/project.json") ?? "");

  const failed = new StandaloneProductionService({
    files: {
      ensureProduction: async () => undefined,
      writeProductionText: async ({ projectId, relativePath, value }) => { values.set(`${projectId}/${relativePath}`, value); },
      readProductionText: async ({ projectId, relativePath }) => ({ value: values.get(`${projectId}/${relativePath}`) }),
      listProductionIds: async () => ({ projectIds: ["project-1"] }),
    },
    native: { pickAssets: async () => ({ assets: [] }), render: async () => { throw new Error("unused"); } },
    analysis: { get: async () => analysis, run: async () => analysis },
    getProvider: async () => ({ generate: async () => { throw new Error("provider down"); }, transcribe: async () => "" }),
    toDisplayUri: (uri) => uri,
  });

  await assert.rejects(() => failed.generatePlan("project-1"), /provider down/u);
  const persisted = await failed.get("project-1");
  assert.equal(persisted?.status, "failed");
  assert.equal(persisted?.assets.length, 3);
});

test("制作项目恢复中断的规划状态并保留已导入素材", async () => {
  const { create, values } = harness();
  const service = create();
  await service.create({ analysisTaskId: "task-1", brief: "真实门店", targetDurationSeconds: 20 });
  await service.importAssets("project-1");
  const stored = JSON.parse(values.get("project-1/project.json") ?? "{}") as Record<string, unknown>;
  values.set("project-1/project.json", JSON.stringify({ ...stored, status: "planning" }));

  assert.deepEqual(await service.inspectUnfinishedWork(), [{
    kind: "production-plan",
    id: "project-1",
    source: "persisted",
    execution: "in-process",
  }]);
  assert.equal((await service.recoverInterruptedWork()).length, 1);
  assert.equal((await service.recoverInterruptedWork()).length, 0);

  const recovered = await service.get("project-1");
  assert.equal(recovered?.status, "failed");
  assert.equal(recovered?.assets.length, 3);
  assert.equal(recovered?.issue?.code, "TASK_INTERRUPTED");
  assert.equal(recovered?.issue?.action, "retry");
});

test("制作项目恢复中断的渲染状态并保留正式计划", async () => {
  const { create, values } = harness();
  const service = create();
  await service.create({ analysisTaskId: "task-1", brief: "真实门店", targetDurationSeconds: 20 });
  await service.importAssets("project-1");
  await service.generatePlan("project-1");
  const stored = JSON.parse(values.get("project-1/project.json") ?? "{}") as Record<string, unknown>;
  values.set("project-1/project.json", JSON.stringify({ ...stored, status: "rendering" }));

  assert.deepEqual(await service.inspectUnfinishedWork(), [{
    kind: "production-render",
    id: "project-1",
    source: "persisted",
    execution: "in-process",
  }]);
  assert.equal((await service.recoverInterruptedWork()).length, 1);
  assert.equal((await service.recoverInterruptedWork()).length, 0);

  const recovered = await service.get("project-1");
  assert.equal(recovered?.status, "failed");
  assert.equal(recovered?.plan?.schemaVersion, "production-plan.v1");
  assert.equal(recovered?.issue?.code, "TASK_INTERRUPTED");
});

test("制作服务按真实 Promise 区分系统素材选择、计划与渲染", async () => {
  const values = new Map<string, string>();
  const ids = new Set<string>();
  const pickerEntered = deferred();
  const pickerRelease = deferred();
  const planEntered = deferred();
  const planRelease = deferred();
  const renderEntered = deferred();
  const renderRelease = deferred();
  const operations = new RuntimeOperationRegistry();
  const assets = [
    { id: "asset-1", uri: "file:///private/a.jpg", kind: "image" as const, mimeType: "image/jpeg", displayName: "a.jpg", sizeBytes: 100 },
    { id: "asset-2", uri: "file:///private/b.mp4", kind: "video" as const, mimeType: "video/mp4", displayName: "b.mp4", sizeBytes: 200 },
    { id: "asset-3", uri: "file:///private/c.png", kind: "image" as const, mimeType: "image/png", displayName: "c.png", sizeBytes: 100 },
  ];
  const service = new StandaloneProductionService({
    files: {
      ensureProduction: async ({ projectId }) => { ids.add(projectId); },
      writeProductionText: async ({ projectId, relativePath, value }) => { values.set(`${projectId}/${relativePath}`, value); },
      readProductionText: async ({ projectId, relativePath }) => ({ value: values.get(`${projectId}/${relativePath}`) }),
      listProductionIds: async () => ({ projectIds: [...ids] }),
    },
    native: {
      pickAssets: async () => {
        pickerEntered.resolve();
        await pickerRelease.promise;
        return { assets };
      },
      render: async () => {
        renderEntered.resolve();
        await renderRelease.promise;
        return { uri: "file:///private/output.mp4", mimeType: "video/mp4", sizeBytes: 1_024, durationSeconds: 20 };
      },
    },
    analysis: { get: async () => analysis, run: async () => analysis },
    getProvider: async () => ({
      generate: async () => {
        planEntered.resolve();
        await planRelease.promise;
        return { content: JSON.stringify(plan), reasoning: "" };
      },
      transcribe: async () => "",
    }),
    toDisplayUri: (uri) => uri,
    createProjectId: () => "project-ops",
    operations,
  });

  await service.create({ analysisTaskId: "task-1", brief: "真实制作", targetDurationSeconds: 20 });
  const importing = service.importAssets("project-ops");
  await pickerEntered.promise;
  assert.deepEqual(operations.list(), [{ kind: "transient-operation", id: "production-assets:project-ops", source: "memory", execution: "external-activity" }]);
  pickerRelease.resolve();
  await importing;
  assert.deepEqual(operations.list(), []);

  const planning = service.generatePlan("project-ops");
  await planEntered.promise;
  assert.deepEqual(operations.list(), [{ kind: "production-plan", id: "project-ops", source: "memory", execution: "in-process" }]);
  planRelease.resolve();
  await planning;
  assert.deepEqual(operations.list(), []);

  const rendering = service.render("project-ops");
  await renderEntered.promise;
  assert.deepEqual(operations.list(), [{ kind: "production-render", id: "project-ops", source: "memory", execution: "in-process" }]);
  renderRelease.resolve();
  await rendering;
  assert.deepEqual(operations.list(), []);
});
