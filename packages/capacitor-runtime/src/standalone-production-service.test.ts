import assert from "node:assert/strict";
import test from "node:test";

import { MIMO_CHAT_AUDIO_TTS_INSTRUCTION, STEPFUN_AUDIO_SPEECH_TTS_INSTRUCTION, type AiProvider, type ProductionPlanResultV2 } from "@hongtai/ai";
import type { ContentAnalysisRecord, TaskDetailRecord } from "@hongtai/core";

import { RuntimeOperationRegistry } from "./runtime-operation-registry.js";
import { StandaloneProductionService } from "./standalone-production-service.js";

const plan: ProductionPlanResultV2 = {
  schemaVersion: "production-plan.v2",
  source: { analysisTaskId: "task-1" },
  title: "门店真实体验",
  settings: { width: 720, height: 1280, fps: 30, durationSeconds: 20 },
  audio: { voiceLocale: "zh-CN", speechRate: 1, backgroundMusicAssetId: null, backgroundMusicVolume: 0 },
  textOverlay: { primaryText: "真实门店", secondaryText: "看环境，也看过程", preset: "classic_top" },
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

const taskDetail = {
  task: { id: "task-1" },
  content: {},
  media: [],
  transcript: { source: "asr", text: "原视频介绍了门店场地与合作方式，只作为创作结构参考。", segments: [] },
  evidenceUnits: [],
} as unknown as TaskDetailRecord;
const tasks = { getDetail: async () => taskDetail };

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve };
}

function harness(narration: "system" | "provider" = "system", now?: () => Date) {
  const values = new Map<string, string>();
  const ids = new Set<string>();
  const deletedPaths: string[] = [];
  const pickCalls: Array<{ readonly projectId: string; readonly maxItems: number; readonly selection?: "visual" | "avatar" }> = [];
  const renderCalls: Array<{
    readonly projectId: string;
    readonly planJson: string;
    readonly mode?: "montage" | "avatar";
    readonly narration?: "system" | "provider";
    readonly miMoInstruction?: string;
    readonly stepFunInstruction?: string;
  }> = [];
  const planningPrompts: string[] = [];
  const files = {
    ensureProduction: async ({ projectId }: { readonly projectId: string }) => { ids.add(projectId); },
    writeProductionText: async ({ projectId, relativePath, value }: { readonly projectId: string; readonly relativePath: string; readonly value: string; readonly replace: boolean }) => { values.set(`${projectId}/${relativePath}`, value); },
    readProductionText: async ({ projectId, relativePath }: { readonly projectId: string; readonly relativePath: string }) => ({ value: values.get(`${projectId}/${relativePath}`) }),
    listProductionIds: async () => ({ projectIds: [...ids] }),
    deleteProductionFile: async ({ projectId, relativePath }: { readonly projectId: string; readonly relativePath: string }) => { deletedPaths.push(relativePath); values.delete(`${projectId}/${relativePath}`); },
    deleteProduction: async ({ projectId }: { readonly projectId: string }) => {
      ids.delete(projectId);
      for (const path of [...values.keys()]) if (path.startsWith(`${projectId}/`)) values.delete(path);
    },
  };
  const provider: AiProvider = {
    generate: async (request) => {
      planningPrompts.push(String(request.messages[0]?.content ?? ""));
      return { content: JSON.stringify(plan), reasoning: "" };
    },
    transcribe: async () => "",
  };
  const native = {
    pickAssets: async (options: { readonly projectId: string; readonly maxItems: number; readonly selection?: "visual" | "avatar" }) => {
      pickCalls.push(options);
      return { assets: options.selection === "avatar" ? [
        { id: "avatar-1", uri: "file:///private/productions/project-1/inputs/avatar-1.mp4", role: "avatar" as const, kind: "video" as const, mimeType: "video/mp4", displayName: "数字人口播.mp4", sizeBytes: 200, durationSeconds: 20 },
      ] : [
      { id: "asset-1", uri: "file:///private/productions/project-1/inputs/asset-1.jpg", kind: "image" as const, mimeType: "image/jpeg", displayName: "门店.jpg", sizeBytes: 100 },
      { id: "asset-2", uri: "file:///private/productions/project-1/inputs/asset-2.mp4", kind: "video" as const, mimeType: "video/mp4", displayName: "服务.mp4", sizeBytes: 200, durationSeconds: 12 },
      { id: "asset-3", uri: "file:///private/productions/project-1/inputs/asset-3.png", kind: "image" as const, mimeType: "image/png", displayName: "细节.png", sizeBytes: 50 },
      ] };
    },
    render: async (options: {
      readonly projectId: string;
      readonly planJson: string;
      readonly mode?: "montage" | "avatar";
      readonly narration?: "system" | "provider";
      readonly miMoInstruction?: string;
      readonly stepFunInstruction?: string;
    }) => {
      renderCalls.push(options);
      return { uri: "file:///private/productions/project-1/output.mp4", mimeType: "video/mp4" as const, sizeBytes: 1_024, durationSeconds: 20 };
    },
    consumeAssetOperation: async () => ({ status: "none" as const }),
    probeTts: async () => undefined,
  };
  const create = () => new StandaloneProductionService({
    files,
    native,
    analysis: { get: async () => analysis, run: async () => analysis, importVideo: async () => analysis, consumeVideoRecovery: async () => ({ status: "none" as const }), subscribe: () => () => undefined },
    tasks,
    getProvider: async () => provider,
    getNarrationMode: async () => narration,
    toDisplayUri: (uri: string) => uri.replace("file:///private/", "capacitor://localhost/private/"),
    createProjectId: () => "project-1",
    now: now ?? (() => new Date("2026-08-08T00:00:00.000Z")),
  });
  return { create, values, ids, files, pickCalls, renderCalls, planningPrompts, deletedPaths };
}

/** Each persist has to land on a distinct `updatedAt` for the stale-write check to mean anything. */
function steppingClock(): () => Date {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 8, 0, 0, (tick += 1)));
}

async function plannedProject(now: () => Date) {
  const context = harness("system", now);
  const service = context.create();
  await service.create({ analysisTaskId: "task-1", brief: "突出真实服务", targetDurationSeconds: 20 });
  await service.importAssets("project-1");
  const ready = await service.generatePlan("project-1");
  return { ...context, service, ready };
}

function shotsOf(record: { readonly plan?: { readonly document: unknown } }) {
  return (record.plan?.document as { readonly shots: readonly {
    readonly order: number;
    readonly narration: string;
    readonly durationSeconds: number;
    readonly cues: readonly { readonly text: string; readonly startMs: number; readonly endMs: number }[];
  }[] }).shots;
}

function subtitleOf(record: { readonly plan?: { readonly document: unknown } }) {
  return (record.plan?.document as { readonly subtitle: {
    readonly templateId: string;
    readonly degradedFromTemplateId: string | null;
    readonly timing: { readonly precision: string; readonly source: string };
  } }).subtitle;
}

test("制作项目导入素材、生成计划和渲染结果后可在重启后恢复", async () => {
  const { create, renderCalls, planningPrompts } = harness();
  const service = create();
  await service.create({ analysisTaskId: "task-1", brief: "突出真实服务", targetDurationSeconds: 20 });
  const imported = await service.importAssets("project-1");
  assert.equal(imported.assets.length, 3);

  const ready = await service.generatePlan("project-1");
  assert.equal(ready.status, "ready");
  assert.equal(ready.plan?.schemaVersion, "production-plan.v3");
  assert.match(planningPrompts[0] ?? "", /原视频介绍了门店场地与合作方式/u);
  assert.match(planningPrompts[0] ?? "", /仅供创作参考/u);

  const completed = await service.render("project-1");
  assert.equal(completed.status, "succeeded");
  assert.match(completed.output?.uri ?? "", /^capacitor:\/\//u);
  assert.equal(renderCalls[0]?.narration, "system");
  assert.equal(renderCalls[0]?.miMoInstruction, undefined);
  assert.equal(renderCalls[0]?.stepFunInstruction, undefined);

  const restored = await create().get("project-1");
  assert.equal(restored?.status, "succeeded");
  assert.equal(restored?.assets[0]?.uri.includes("file://"), false);
  assert.deepEqual(
    (restored?.plan?.document as { subtitle?: unknown } | undefined)?.subtitle,
    { templateId: "classic_line", timing: { precision: "estimated", source: "script_estimate" }, degradedFromTemplateId: null },
    "重启后字幕时间精度必须仍可被界面读取",
  );
  assert.equal((await create().list()).length, 1);
});

test("微调计划按新文案重建字幕时间轴，并作废已经不匹配的成片", async () => {
  const { service, ready, create, deletedPaths } = await plannedProject(steppingClock());
  const rendered = await service.render("project-1");
  assert.equal(rendered.status, "succeeded");
  assert.ok(rendered.output, "先渲染出成片，微调才需要处理作废");
  void ready;

  const edited = await service.updatePlan("project-1", {
    expectedUpdatedAt: rendered.updatedAt,
    shots: [
      { order: 1, narration: "先看清真实环境，再看服务过程是否让人放心。", durationSeconds: 10 },
      { order: 2, durationSeconds: 10 },
    ],
  });

  assert.equal(edited.status, "ready", "微调后必须回到待合成，而不是继续显示已完成");
  assert.equal(edited.output, undefined, "旧成片与新计划不符，不能留在界面上");
  assert.ok(deletedPaths.includes("output.mp4"), "作废的成片文件必须真的删掉");

  const shots = shotsOf(edited);
  assert.equal(shots[0]?.narration, "先看清真实环境，再看服务过程是否让人放心。");
  assert.equal(shots[0]?.durationSeconds, 10);
  assert.equal(
    shots[0]?.cues.map((cue) => cue.text).join(""),
    "先看清真实环境，再看服务过程是否让人放心。",
    "字幕必须按新文案重建，不能留下旧文案的时间轴",
  );
  assert.equal(shots[0]?.cues.at(-1)?.endMs, 10_000, "重建的字幕必须铺满新的镜头时长");
  assert.equal(shots[1]?.narration, "再了解完整服务过程。", "没有改到的镜头文案不应被动过");

  const restored = await create().get("project-1");
  assert.equal(restored?.status, "ready", "重启后仍是待合成");
  assert.equal(shotsOf(restored!)[0]?.durationSeconds, 10, "微调结果必须落盘");
});

test("过期版本号的微调被拒绝，且不覆盖已经更新的计划", async () => {
  const { service, ready } = await plannedProject(steppingClock());
  const staleUpdatedAt = ready.updatedAt;

  const first = await service.updatePlan("project-1", {
    expectedUpdatedAt: staleUpdatedAt,
    shots: [{ order: 1, narration: "第一次修改后的口播内容。" }],
  });
  assert.notEqual(first.updatedAt, staleUpdatedAt, "成功的微调必须推进版本");

  await assert.rejects(
    () => service.updatePlan("project-1", {
      expectedUpdatedAt: staleUpdatedAt,
      shots: [{ order: 1, narration: "拿着旧界面提交的第二次修改。" }],
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "PRODUCTION_PLAN_VERSION_STALE");
      assert.equal((error as { action?: string }).action, "retry");
      return true;
    },
  );

  const current = await service.get("project-1");
  assert.equal(shotsOf(current!)[0]?.narration, "第一次修改后的口播内容。", "过期写入不能覆盖更新的计划");
});

test("镜头时长之和不等于目标时长时拒绝微调，且不写坏已落盘的计划", async () => {
  const { service, ready, values } = await plannedProject(steppingClock());
  const before = values.get("project-1/project.json");

  await assert.rejects(
    () => service.updatePlan("project-1", {
      expectedUpdatedAt: ready.updatedAt,
      shots: [{ order: 1, durationSeconds: 10 }],
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "PRODUCTION_PLAN_EDIT_INVALID");
      assert.equal((error as { action?: string }).action, "edit_input");
      assert.match((error as Error).message, /多 2\.000 秒/u, "错误必须说明超出多少时间");
      return true;
    },
  );

  assert.equal(values.get("project-1/project.json"), before, "校验失败不能写盘");
  const current = await service.get("project-1");
  assert.equal(current?.updatedAt, ready.updatedAt, "校验失败不能推进版本");
});

test("微调选择逐字点亮模板时降级为逐行，并留下用户原本的选择", async () => {
  const { service, ready } = await plannedProject(steppingClock());
  assert.equal(subtitleOf(ready).templateId, "classic_line");

  const edited = await service.updatePlan("project-1", {
    expectedUpdatedAt: ready.updatedAt,
    subtitleTemplateId: "karaoke_glow",
  });

  const subtitle = subtitleOf(edited);
  assert.equal(subtitle.templateId, "classic_line", "拿不到词级时间时不能伪造逐字点亮");
  assert.equal(subtitle.degradedFromTemplateId, "karaoke_glow", "用户原本的选择必须可被界面读取");
  assert.deepEqual(subtitle.timing, { precision: "estimated", source: "script_estimate" });

  const kept = await service.updatePlan("project-1", {
    expectedUpdatedAt: edited.updatedAt,
    shots: [{ order: 1, narration: "再改一次文案，模板选择不应被这次修改吃掉。" }],
  });
  assert.equal(subtitleOf(kept).degradedFromTemplateId, "karaoke_glow", "后续微调必须保留原本的模板选择");
});

test("微调把用户输入错误报成可编辑，而不是让界面去重跑 AI", async () => {
  const { service, ready } = await plannedProject(steppingClock());
  const cases: Array<{ readonly edit: Record<string, unknown>; readonly message: RegExp }> = [
    { edit: { subtitleTemplateId: "not_a_template" }, message: /字幕模板/u },
    { edit: { shots: [{ order: 1, assetId: "asset-404" }] }, message: /不存在的素材/u },
    { edit: { speechRate: 5 }, message: /语速需要在 0\.75 到 1\.25 之间/u },
    { edit: { speechRate: Number.NaN }, message: /语速需要在/u },
    { edit: { backgroundMusicVolume: 9 }, message: /背景音乐音量需要在 0 到 0\.35 之间/u },
    { edit: { headlineText: "一二三四五六七八九十一二三四五六七八九十一二三四五" }, message: /主文字最多 24 个字/u },
    { edit: { shots: [{ order: 1, durationSeconds: 0.5 }] }, message: /时长需要在 1 到 20 秒之间/u },
    { edit: { shots: [{ order: 1, durationSeconds: 21 }] }, message: /时长需要在 1 到 20 秒之间/u },
  ];

  for (const { edit, message } of cases) {
    await assert.rejects(
      () => service.updatePlan("project-1", { expectedUpdatedAt: ready.updatedAt, ...edit }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "PRODUCTION_PLAN_EDIT_INVALID", `${JSON.stringify(edit)} 应报成可编辑错误`);
        assert.equal((error as { action?: string }).action, "edit_input");
        assert.match((error as Error).message, message);
        return true;
      },
    );
  }
});

test("微调不能把镜头时长改成渲染器无法表达的毫秒值", async () => {
  const { service, ready, renderCalls } = await plannedProject(steppingClock());
  // 8.005 秒在 IEEE-754 下是 8004.999999999999 毫秒，宽松判定会放过、渲染器会拒绝。
  const edited = await service.updatePlan("project-1", {
    expectedUpdatedAt: ready.updatedAt,
    shots: [{ order: 1, durationSeconds: 8.005 }, { order: 2, durationSeconds: 11.995 }],
  });

  const shots = shotsOf(edited);
  const totalMs = shots.reduce((sum, shot) => sum + Math.round(shot.durationSeconds * 1_000), 0);
  assert.equal(totalMs, 20_000, "毫秒总和必须精确等于目标时长");
  for (const shot of shots) {
    const milliseconds = shot.durationSeconds * 1_000;
    assert.ok(Math.abs(milliseconds - Math.round(milliseconds)) < 1e-6, `镜头 ${shot.order} 的时长不是整毫秒`);
  }

  await service.render("project-1");
  const planJson = renderCalls.at(-1)?.planJson ?? "";
  assert.match(planJson, /"durationSeconds":8\.005/u, "落到渲染器的仍是用户填写的时长");
});

test("数字人口播不接受改口播与改时长，避免字幕与原声对不上", async () => {
  const context = harness("system", steppingClock());
  const service = context.create();
  await service.create({
    analysisTaskId: "task-1",
    brief: "介绍门店",
    targetDurationSeconds: 20,
    mode: "avatar",
    avatarScript: "欢迎来到我们的门店。今天带你看看真实服务过程，看完你就知道值不值。",
  });
  await service.importAssets("project-1");
  const ready = await service.generatePlan("project-1");

  await assert.rejects(
    () => service.updatePlan("project-1", { expectedUpdatedAt: ready.updatedAt, shots: [{ order: 1, narration: "和原声完全不同的一句话。" }] }),
    /字幕来自原声口播稿/u,
  );
  await assert.rejects(
    () => service.updatePlan("project-1", { expectedUpdatedAt: ready.updatedAt, shots: [{ order: 1, durationSeconds: 2 }] }),
    /镜头时长跟随原视频/u,
  );

  const templateOnly = await service.updatePlan("project-1", { expectedUpdatedAt: ready.updatedAt, subtitleTemplateId: "keyword_pop" });
  assert.equal(subtitleOf(templateOnly).templateId, "keyword_pop", "数字人模式仍可换字幕模板");
});

test("微调不能逐字照搬来源原文，和生成计划受同一条原创约束", async () => {
  const { service, ready } = await plannedProject(steppingClock());
  await assert.rejects(
    () => service.updatePlan("project-1", {
      expectedUpdatedAt: ready.updatedAt,
      shots: [{ order: 1, narration: "原视频介绍了门店场地与合作方式，只作为创作结构参考。" }],
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "PRODUCTION_PLAN_EDIT_INVALID");
      assert.match((error as Error).message, /连续重复/u);
      return true;
    },
  );
});

test("作废成片失败时回滚到微调前状态，并给出可分支的稳定错误", async () => {
  const now = steppingClock();
  const context = harness("system", now);
  const service = context.create();
  await service.create({ analysisTaskId: "task-1", brief: "突出真实服务", targetDurationSeconds: 20 });
  await service.importAssets("project-1");
  await service.generatePlan("project-1");
  const rendered = await service.render("project-1");
  const before = context.values.get("project-1/project.json");

  context.files.deleteProductionFile = async () => { throw new Error("EBUSY"); };
  await assert.rejects(
    () => service.updatePlan("project-1", {
      expectedUpdatedAt: rendered.updatedAt,
      shots: [{ order: 1, narration: "改一句口播来触发成片作废。" }],
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "STORAGE_WRITE_FAILED", "文件失败必须映射成稳定错误码");
      assert.equal((error as { action?: string }).action, "retry");
      return true;
    },
  );

  assert.equal(context.values.get("project-1/project.json"), before, "回滚后盘上状态必须与微调前完全一致");
  const restored = await service.get("project-1");
  assert.equal(restored?.status, "succeeded", "回滚后仍是渲染完成，不能留在半成状态");
  assert.ok(restored?.output, "回滚后成片记录必须还在");
});

test("微调换用非可播素材或不存在的镜头时按稳定错误拒绝", async () => {
  const { service, ready } = await plannedProject(steppingClock());

  await assert.rejects(
    () => service.updatePlan("project-1", { expectedUpdatedAt: ready.updatedAt, shots: [{ order: 9, narration: "不存在的镜头。" }] }),
    /制作计划里没有第 9 个镜头/u,
  );
  await assert.rejects(
    () => service.updatePlan("project-1", { expectedUpdatedAt: ready.updatedAt, shots: [{ order: 1, assetId: "asset-404" }] }),
    /不存在的素材/u,
  );
  await assert.rejects(
    () => service.updatePlan("project-1", { expectedUpdatedAt: ready.updatedAt, shots: [{ order: 1, narration: "   " }] }),
    /口播内容不能为空/u,
  );
});

test("渲染进度只转发原生 stage 和百分比，不补文案也不回传 message", async () => {
  const values = new Map<string, string>();
  const ids = new Set<string>();
  let progressListener: ((event: {
    readonly projectId: string;
    readonly progress: number;
    readonly stage: string;
    readonly message?: string;
  }) => void) | undefined;
  const service = new StandaloneProductionService({
    files: {
      ensureProduction: async ({ projectId }) => { ids.add(projectId); },
      writeProductionText: async ({ projectId, relativePath, value }) => { values.set(`${projectId}/${relativePath}`, value); },
      readProductionText: async ({ projectId, relativePath }) => ({ value: values.get(`${projectId}/${relativePath}`) }),
      listProductionIds: async () => ({ projectIds: [...ids] }),
      deleteProductionFile: async () => undefined,
      deleteProduction: async () => undefined,
    },
    native: {
      pickAssets: async () => ({
        assets: [
          { id: "asset-1", uri: "file:///private/productions/project-1/inputs/asset-1.jpg", kind: "image", mimeType: "image/jpeg", displayName: "门店.jpg", sizeBytes: 100 },
          { id: "asset-2", uri: "file:///private/productions/project-1/inputs/asset-2.mp4", kind: "video", mimeType: "video/mp4", displayName: "服务.mp4", sizeBytes: 200, durationSeconds: 12 },
          { id: "asset-3", uri: "file:///private/productions/project-1/inputs/asset-3.png", kind: "image", mimeType: "image/png", displayName: "细节.png", sizeBytes: 50 },
        ],
      }),
      consumeAssetOperation: async () => ({ status: "none" as const }),
      probeTts: async () => undefined,
      addListener: async (_eventName, listener) => {
        progressListener = listener;
        return { remove: async () => { progressListener = undefined; } };
      },
      render: async ({ projectId }) => {
        progressListener?.({ projectId, progress: 5, stage: "synthesize_narration" });
        progressListener?.({ projectId, progress: 35, stage: "export", message: "正在本地合成" });
        progressListener?.({ projectId, progress: 40, stage: "unknown_future_stage" });
        progressListener?.({ projectId: "other-project", progress: 99, stage: "saved" });
        return { uri: "file:///private/productions/project-1/output.mp4", mimeType: "video/mp4", sizeBytes: 1_024, durationSeconds: 20 };
      },
    },
    analysis: { get: async () => analysis, run: async () => analysis, importVideo: async () => analysis, consumeVideoRecovery: async () => ({ status: "none" as const }), subscribe: () => () => undefined },
    tasks,
    getProvider: async () => ({ generate: async () => ({ content: JSON.stringify(plan), reasoning: "" }), transcribe: async () => "" }),
    getNarrationMode: async () => "system",
    toDisplayUri: (uri) => uri,
    createProjectId: () => "project-1",
    now: () => new Date("2026-08-08T00:00:00.000Z"),
  });

  await service.create({ analysisTaskId: "task-1", brief: "突出真实服务", targetDurationSeconds: 20 });
  await service.importAssets("project-1");
  await service.generatePlan("project-1");
  const events: unknown[] = [];
  const unsubscribe = service.subscribe("project-1", (event) => { events.push(event); });
  await service.render("project-1");
  unsubscribe();

  const progress = events.filter((event): event is { readonly type: "render-progress"; readonly projectId: string; readonly progress: number; readonly stage: string } =>
    Boolean(event && typeof event === "object" && "type" in event && event.type === "render-progress"));
  assert.deepEqual(progress, [
    { type: "render-progress", projectId: "project-1", progress: 5, stage: "synthesize_narration" },
    { type: "render-progress", projectId: "project-1", progress: 35, stage: "export" },
    { type: "render-progress", projectId: "project-1", progress: 40, stage: "unknown_future_stage" },
  ]);
  assert.equal(progress.every((event) => !("message" in event)), true);
  assert.equal(JSON.stringify(progress).includes("正在"), false);
});

test("StandaloneProductionService listener failures never rewrite a succeeded render", async () => {
  const { create, values } = harness();
  const deleted: string[] = [];
  const files = {
    ensureProduction: async () => undefined,
    writeProductionText: async ({ projectId, relativePath, value }: { readonly projectId: string; readonly relativePath: string; readonly value: string }) => {
      values.set(`${projectId}/${relativePath}`, value);
    },
    readProductionText: async ({ projectId, relativePath }: { readonly projectId: string; readonly relativePath: string }) => ({ value: values.get(`${projectId}/${relativePath}`) }),
    listProductionIds: async () => ({ projectIds: ["project-1"] }),
    deleteProductionFile: async ({ projectId, relativePath }: { readonly projectId: string; readonly relativePath: string }) => {
      deleted.push(`${projectId}/${relativePath}`);
    },
    deleteProduction: async () => undefined,
  };
  const service = create();
  await service.create({ analysisTaskId: "task-1", brief: "突出真实服务", targetDurationSeconds: 20 });
  await service.importAssets("project-1");
  await service.generatePlan("project-1");
  const isolated = new StandaloneProductionService({
    files,
    native: {
      pickAssets: async () => ({ assets: [] }),
      consumeAssetOperation: async () => ({ status: "none" as const }),
      probeTts: async () => undefined,
      render: async () => ({ uri: "file:///private/productions/project-1/output.mp4", mimeType: "video/mp4", sizeBytes: 1_024, durationSeconds: 20 }),
    },
    analysis: { get: async () => analysis, run: async () => analysis, importVideo: async () => analysis, consumeVideoRecovery: async () => ({ status: "none" as const }), subscribe: () => () => undefined },
    tasks,
    getProvider: async () => ({ generate: async () => ({ content: JSON.stringify(plan), reasoning: "" }), transcribe: async () => "" }),
    getNarrationMode: async () => "system",
    toDisplayUri: (uri) => uri.replace("file:///private/", "capacitor://localhost/private/"),
    createProjectId: () => "project-1",
    now: () => new Date("2026-08-08T00:00:00.000Z"),
  });
  isolated.subscribe("project-1", () => { throw new Error("broken production view"); });

  const completed = await isolated.render("project-1");
  const persisted = JSON.parse(values.get("project-1/project.json") ?? "{}") as { readonly status?: string; readonly output?: { readonly uri?: string } };

  assert.equal(completed.status, "succeeded");
  assert.equal(completed.output?.uri, "capacitor://localhost/private/productions/project-1/output.mp4");
  assert.equal(persisted.status, "succeeded");
  assert.equal(persisted.output?.uri, "file:///private/productions/project-1/output.mp4");
  assert.deepEqual(deleted, []);
  assert.equal((await isolated.get("project-1"))?.status, "succeeded");
});

test("已配置的云端 TTS 会明确交给原生渲染器合成旁白", async () => {
  const { create, renderCalls } = harness("provider");
  const service = create();
  await service.create({ analysisTaskId: "task-1", brief: "突出真实服务", targetDurationSeconds: 20 });
  await service.importAssets("project-1");
  await service.generatePlan("project-1");
  await service.render("project-1");

  assert.equal(renderCalls[0]?.narration, "provider");
  assert.equal(renderCalls[0]?.miMoInstruction, MIMO_CHAT_AUDIO_TTS_INSTRUCTION);
  assert.equal(renderCalls[0]?.stepFunInstruction, STEPFUN_AUDIO_SPEECH_TTS_INSTRUCTION);
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
      deleteProductionFile: async () => undefined,
      deleteProduction: async () => undefined,
    },
    native: { pickAssets: async () => ({ assets: [] }), consumeAssetOperation: async () => ({ status: "none" as const }), render: async () => { throw new Error("unused"); }, probeTts: async () => undefined },
    analysis: { get: async () => analysis, run: async () => analysis, importVideo: async () => analysis, consumeVideoRecovery: async () => ({ status: "none" as const }), subscribe: () => () => undefined },
    tasks,
    getProvider: async () => ({ generate: async () => { throw new Error("provider down"); }, transcribe: async () => "" }),
    getNarrationMode: async () => "system",
    toDisplayUri: (uri) => uri,
  });

  await assert.rejects(() => failed.generatePlan("project-1"), /provider down/u);
  const persisted = await failed.get("project-1");
  assert.equal(persisted?.status, "failed");
  assert.equal(persisted?.assets.length, 3);
});

test("没有正式拆解时生成计划失败且不得进入 ready", async () => {
  const { create, files } = harness();
  const seeded = create();
  await seeded.create({ analysisTaskId: "task-1", brief: "真实门店", targetDurationSeconds: 20 });
  await seeded.importAssets("project-1");
  const missing = new StandaloneProductionService({
    files,
    native: { pickAssets: async () => ({ assets: [] }), consumeAssetOperation: async () => ({ status: "none" as const }), render: async () => { throw new Error("unused"); }, probeTts: async () => undefined },
    analysis: { get: async () => undefined, run: async () => analysis, importVideo: async () => analysis, consumeVideoRecovery: async () => ({ status: "none" as const }), subscribe: () => () => undefined },
    tasks,
    getProvider: async () => ({ generate: async () => ({ content: JSON.stringify(plan), reasoning: "" }), transcribe: async () => "" }),
    getNarrationMode: async () => "system",
    toDisplayUri: (uri) => uri,
  });
  await assert.rejects(() => missing.generatePlan("project-1"), /正式拆解/u);
  const persisted = await missing.get("project-1");
  assert.equal(persisted?.status, "failed");
  assert.equal(persisted?.plan, undefined);
});

test("来源任务没有原文时生成计划失败且不得进入 ready", async () => {
  const { create, files } = harness();
  const seeded = create();
  await seeded.create({ analysisTaskId: "task-1", brief: "真实门店", targetDurationSeconds: 20 });
  await seeded.importAssets("project-1");
  const emptyDetail = {
    task: { id: "task-1" },
    content: {},
    media: [],
    transcript: { source: "asr", text: "", segments: [] },
    evidenceUnits: [],
  } as unknown as TaskDetailRecord;
  const missing = new StandaloneProductionService({
    files,
    native: { pickAssets: async () => ({ assets: [] }), consumeAssetOperation: async () => ({ status: "none" as const }), render: async () => { throw new Error("unused"); }, probeTts: async () => undefined },
    analysis: { get: async () => analysis, run: async () => analysis, importVideo: async () => analysis, consumeVideoRecovery: async () => ({ status: "none" as const }), subscribe: () => () => undefined },
    tasks: { getDetail: async () => emptyDetail },
    getProvider: async () => ({ generate: async () => ({ content: JSON.stringify(plan), reasoning: "" }), transcribe: async () => "" }),
    getNarrationMode: async () => "system",
    toDisplayUri: (uri) => uri,
  });
  await assert.rejects(() => missing.generatePlan("project-1"), /原始文稿/u);
  const persisted = await missing.get("project-1");
  assert.equal(persisted?.status, "failed");
  assert.equal(persisted?.plan, undefined);
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
  assert.equal(recovered?.plan?.schemaVersion, "production-plan.v3");
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
      deleteProductionFile: async () => undefined,
      deleteProduction: async () => undefined,
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
      consumeAssetOperation: async () => ({ status: "none" as const }),
      probeTts: async () => undefined,
    },
    analysis: { get: async () => analysis, run: async () => analysis, importVideo: async () => analysis, consumeVideoRecovery: async () => ({ status: "none" as const }), subscribe: () => () => undefined },
    tasks,
    getProvider: async () => ({
      generate: async () => {
        planEntered.resolve();
        await planRelease.promise;
        return { content: JSON.stringify(plan), reasoning: "" };
      },
      transcribe: async () => "",
    }),
    toDisplayUri: (uri) => uri,
    getNarrationMode: async () => "system",
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
  await assert.rejects(() => service.delete("project-ops"), /正在/u);
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

test("制作素材、成片和项目删除同步更新持久状态与私有文件", async () => {
  const { create, values } = harness();
  const service = create();
  await service.create({ analysisTaskId: "task-1", brief: "真实门店", targetDurationSeconds: 20 });
  await service.importAssets("project-1");
  await service.generatePlan("project-1");
  await service.render("project-1");

  const ready = await service.removeOutput("project-1");
  assert.equal(ready.status, "ready");
  assert.ok(ready.plan);
  assert.equal(ready.output, undefined);

  await service.render("project-1");
  const draft = await service.removeAsset("project-1", "asset-1");
  assert.equal(draft.status, "draft");
  assert.equal(draft.assets.length, 2);
  assert.equal(draft.plan, undefined);
  assert.equal(draft.output, undefined);

  await service.delete("project-1");
  assert.equal((await service.list()).length, 0);
  assert.equal([...values.keys()].some((path) => path.startsWith("project-1/")), false);
});

test("制作项目在规划或渲染中拒绝删除且同一项目只允许一个变更", async () => {
  const { create, values } = harness();
  const service = create();
  await service.create({ analysisTaskId: "task-1", brief: "真实门店", targetDurationSeconds: 20 });
  await service.importAssets("project-1");
  await service.generatePlan("project-1");
  await service.render("project-1");
  const raw = JSON.parse(values.get("project-1/project.json") ?? "{}") as Record<string, unknown>;
  values.set("project-1/project.json", JSON.stringify({ ...raw, status: "planning" }));
  await assert.rejects(() => service.delete("project-1"), /正在/u);

  values.set("project-1/project.json", JSON.stringify(raw));
  const original = service.removeOutput("project-1");
  const competing = service.removeAsset("project-1", "asset-1");
  await assert.rejects(() => competing, /正在/u);
  await original;
});

test("数字人口播项目要求口播稿、只导入一个视频，并在本地生成原声字幕计划", async () => {
  const { create, pickCalls } = harness();
  const service = create();

  await assert.rejects(
    () => service.create({ analysisTaskId: "task-1", brief: "自然介绍门店", targetDurationSeconds: 20, mode: "avatar" }),
    /口播稿/u,
  );

  const project = await service.create({
    analysisTaskId: "task-1",
    brief: "自然介绍门店",
    targetDurationSeconds: 20,
    mode: "avatar",
    avatarScript: "欢迎来到我们的门店。今天带你看看真实服务过程。",
  });
  const imported = await service.importAssets(project.projectId);

  assert.equal(imported.mode, "avatar");
  assert.equal(imported.assets[0]?.role, "avatar");
  assert.deepEqual(pickCalls, [{ projectId: "project-1", maxItems: 1, selection: "avatar" }]);

  const ready = await service.generatePlan(project.projectId);
  const shots = ready.plan?.document.shots;
  assert.equal(Array.isArray(shots), true);
  assert.equal((shots as readonly { readonly assetId: string }[]).every((shot) => shot.assetId === "avatar-1"), true);
  assert.equal((shots as readonly { readonly caption: string }[]).map((shot) => shot.caption).join(""), "欢迎来到我们的门店。今天带你看看真实服务过程。");
});

test("制作服务将原生媒体和 TTS 失败转换为可行动的稳定错误", async () => {
  const { values } = harness();
  const service = new StandaloneProductionService({
    files: {
      ensureProduction: async () => undefined,
      writeProductionText: async ({ projectId, relativePath, value }) => { values.set(`${projectId}/${relativePath}`, value); },
      readProductionText: async ({ projectId, relativePath }) => ({ value: values.get(`${projectId}/${relativePath}`) }),
      listProductionIds: async () => ({ projectIds: ["project-1"] }),
      deleteProductionFile: async () => undefined,
      deleteProduction: async () => undefined,
    },
    native: {
      pickAssets: async () => { throw { code: "ERR_MEDIA_SOURCE_INVALID" }; },
      consumeAssetOperation: async () => ({ status: "none" as const }),
      render: async () => { throw { code: "ERR_TTS_UNAVAILABLE" }; },
      probeTts: async () => undefined,
    },
    analysis: { get: async () => analysis, run: async () => analysis, importVideo: async () => analysis, consumeVideoRecovery: async () => ({ status: "none" as const }), subscribe: () => () => undefined },
    tasks,
    getProvider: async () => ({ generate: async () => ({ content: JSON.stringify(plan), reasoning: "" }), transcribe: async () => "" }),
    getNarrationMode: async () => "system",
    toDisplayUri: (uri) => uri,
    createProjectId: () => "project-1",
  });
  await service.create({ analysisTaskId: "task-1", brief: "真实门店", targetDurationSeconds: 20 });

  await assert.rejects(
    () => service.importAssets("project-1"),
    (error) => error instanceof Error && "code" in error && error.code === "MEDIA_SOURCE_INVALID",
  );

  const draft = JSON.parse(values.get("project-1/project.json") ?? "{}") as Record<string, unknown>;
  values.set("project-1/project.json", JSON.stringify({
    ...draft,
    status: "ready",
    plan,
    output: { uri: "file:///private/productions/project-1/output.mp4", mimeType: "video/mp4", sizeBytes: 512, durationSeconds: 20 },
  }));
  await assert.rejects(
    () => service.render("project-1"),
    (error) => error instanceof Error && "code" in error && error.code === "TTS_UNAVAILABLE",
  );
  const persisted = await service.get("project-1");
  assert.equal(persisted?.issue?.code, "TTS_UNAVAILABLE");
  assert.equal(persisted?.output?.uri, "file:///private/productions/project-1/output.mp4");
});

test("制作服务将导出失败拆成可区分的稳定错误且不再提示更换 MP4", async () => {
  const cases = [
    ["ERR_MEDIA_ENCODER_UNAVAILABLE", "MEDIA_ENCODER_UNAVAILABLE", "retry"],
    ["ERR_MEDIA_DECODE_FAILED", "MEDIA_DECODE_FAILED", "select_media"],
    ["ERR_MEDIA_RENDER_PIPELINE_FAILED", "MEDIA_RENDER_PIPELINE_FAILED", "retry"],
    ["ERR_MEDIA_OUTPUT_INVALID", "MEDIA_OUTPUT_INVALID", "retry"],
    ["ERR_MEDIA_EXPORT_FAILED", "MEDIA_EXPORT_FAILED", "retry"],
  ] as const;

  for (const [nativeCode, code, action] of cases) {
    const values = new Map<string, string>();
    const service = new StandaloneProductionService({
      files: {
        ensureProduction: async () => undefined,
        writeProductionText: async ({ projectId, relativePath, value }) => { values.set(`${projectId}/${relativePath}`, value); },
        readProductionText: async ({ projectId, relativePath }) => ({ value: values.get(`${projectId}/${relativePath}`) }),
        listProductionIds: async () => ({ projectIds: ["project-1"] }),
        deleteProductionFile: async () => undefined,
        deleteProduction: async () => undefined,
      },
      native: {
        pickAssets: async () => ({ assets: [] }),
        consumeAssetOperation: async () => ({ status: "none" as const }),
        render: async () => { throw { code: nativeCode }; },
        probeTts: async () => undefined,
      },
      analysis: { get: async () => analysis, run: async () => analysis, importVideo: async () => analysis, consumeVideoRecovery: async () => ({ status: "none" as const }), subscribe: () => () => undefined },
      tasks,
      getProvider: async () => ({ generate: async () => ({ content: JSON.stringify(plan), reasoning: "" }), transcribe: async () => "" }),
      getNarrationMode: async () => "system",
      toDisplayUri: (uri) => uri,
      createProjectId: () => "project-1",
    });
    await service.create({ analysisTaskId: "task-1", brief: "真实门店", targetDurationSeconds: 20 });
    const draft = JSON.parse(values.get("project-1/project.json") ?? "{}") as Record<string, unknown>;
    values.set("project-1/project.json", JSON.stringify({
      ...draft,
      status: "ready",
      plan,
      output: { uri: "file:///private/productions/project-1/output.mp4", mimeType: "video/mp4", sizeBytes: 512, durationSeconds: 20 },
    }));

    await assert.rejects(
      () => service.render("project-1"),
      (error) => error instanceof Error && "code" in error && error.code === code && "action" in error && error.action === action
        && !error.message.includes("请更换兼容的 MP4 素材"),
    );
    const persisted = await service.get("project-1");
    assert.equal(persisted?.issue?.code, code);
    assert.equal(persisted?.issue?.action, action);
    assert.equal(persisted?.issue?.userMessage.includes("请更换兼容的 MP4 素材"), false);
    assert.equal(persisted?.output?.uri, "file:///private/productions/project-1/output.mp4");
    if (code === "MEDIA_DECODE_FAILED") {
      assert.match(persisted?.issue?.userMessage ?? "", /解码|音轨/);
    }
  }
});

test("StandaloneProductionService consumes a recovered native asset picker as project assets", async () => {
  const { create, values } = harness();
  const created = create();
  await created.create({ analysisTaskId: "task-1", brief: "真实门店", targetDurationSeconds: 20 });
  const service = new StandaloneProductionService({
    files: {
      ensureProduction: async () => undefined,
      writeProductionText: async ({ projectId, relativePath, value }) => { values.set(`${projectId}/${relativePath}`, value); },
      readProductionText: async ({ projectId, relativePath }) => ({ value: values.get(`${projectId}/${relativePath}`) }),
      listProductionIds: async () => ({ projectIds: ["project-1"] }),
      deleteProductionFile: async () => undefined,
      deleteProduction: async () => undefined,
    },
    native: {
      pickAssets: async () => ({ assets: [] }),
      consumeAssetOperation: async () => ({
        status: "succeeded" as const,
        projectId: "project-1",
        assets: [
          { id: "asset-1", uri: "file:///private/productions/project-1/inputs/asset-1.jpg", kind: "image" as const, mimeType: "image/jpeg", displayName: "门店.jpg", sizeBytes: 100 },
        ],
      }),
      render: async () => { throw new Error("unused"); },
      probeTts: async () => undefined,
    },
    analysis: { get: async () => analysis, run: async () => analysis, importVideo: async () => analysis, consumeVideoRecovery: async () => ({ status: "none" as const }), subscribe: () => () => undefined },
    tasks,
    getProvider: async () => ({ generate: async () => ({ content: JSON.stringify(plan), reasoning: "" }), transcribe: async () => "" }),
    getNarrationMode: async () => "system",
    toDisplayUri: (uri) => uri.replace("file:///private/", "capacitor://localhost/private/"),
  });

  const recovered = await service.consumeAssetRecovery();

  assert.equal(recovered.status, "succeeded");
  if (recovered.status !== "succeeded") assert.fail("expected recovered assets");
  assert.equal(recovered.project.assets.length, 1);
  assert.equal(recovered.project.assets[0]?.id, "asset-1");
  assert.doesNotMatch(JSON.stringify(recovered), /file:\/\//);
});

test("StandaloneProductionService maps every recovered native asset terminal to a stable TaskIssue", async () => {
  const expected = new Map<string, string>([
    ["ERR_MEDIA_SELECTION_CANCELLED", "MEDIA_SELECTION_CANCELLED"],
    ["ERR_MEDIA_SOURCE_MISSING", "MEDIA_SOURCE_NOT_FOUND"],
    ["ERR_ASSET_RECOVERY_FAILED", "TASK_INTERRUPTED"],
    ["ERR_MEDIA_READ_FAILED", "MEDIA_READ_FAILED"],
    ["ERR_MEDIA_SOURCE_INVALID", "MEDIA_SOURCE_INVALID"],
    ["ERR_PRIVATE_FILE_IMPORT_FAILED", "MEDIA_IMPORT_FAILED"],
  ]);

  for (const [nativeCode, taskCode] of expected) {
    const { create } = harness();
    const created = create();
    await created.create({ analysisTaskId: "task-1", brief: "真实门店", targetDurationSeconds: 20 });
    const service = new StandaloneProductionService({
      files: {
        ensureProduction: async () => undefined,
        writeProductionText: async () => undefined,
        readProductionText: async () => ({ value: undefined }),
        listProductionIds: async () => ({ projectIds: [] }),
        deleteProductionFile: async () => undefined,
        deleteProduction: async () => undefined,
      },
      native: {
        pickAssets: async () => ({ assets: [] }),
        consumeAssetOperation: async () => ({ status: "failed" as const, code: nativeCode }),
        render: async () => { throw new Error("unused"); },
        probeTts: async () => undefined,
      },
      analysis: { get: async () => analysis, run: async () => analysis, importVideo: async () => analysis, consumeVideoRecovery: async () => ({ status: "none" as const }), subscribe: () => () => undefined },
      tasks,
      getProvider: async () => ({ generate: async () => ({ content: "", reasoning: "" }), transcribe: async () => "" }),
      getNarrationMode: async () => "system",
      toDisplayUri: (uri) => uri,
    });

    const recovered = await service.consumeAssetRecovery();

    assert.equal(recovered.status, "failed", nativeCode);
    if (recovered.status !== "failed") assert.fail(`expected ${nativeCode} to fail`);
    assert.equal(recovered.issue.code, taskCode, nativeCode);
    assert.equal(recovered.issue.action, "select_media", nativeCode);
    assert.equal(recovered.issue.details?.nativeCode, nativeCode);
  }
});
