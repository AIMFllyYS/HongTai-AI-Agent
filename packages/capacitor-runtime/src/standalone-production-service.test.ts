import assert from "node:assert/strict";
import test from "node:test";

import { MIMO_CHAT_AUDIO_TTS_INSTRUCTION, STEPFUN_AUDIO_SPEECH_TTS_INSTRUCTION, type AiProvider, type AiStreamEvent, type DecorationSelection, type ProductionPlanResultV2 } from "@hongtai/ai";
import { DECORATION_IDS, TaskError, type ContentAnalysisRecord, type TaskDetailRecord } from "@hongtai/core";

import { RuntimeOperationRegistry } from "./runtime-operation-registry.js";
import { narrationProgressEvent, type StandaloneProductionEvent } from "./standalone-production-script.js";
import { StandaloneProductionService } from "./standalone-production-service.js";

// Carries a real sticker rather than an empty list: the allow-list is supplied by this service, and
// leaving it out rejects every selection. An empty fixture would pass either way and the feature
// would ship dead.
const plan: ProductionPlanResultV2 & { decorationSelections: readonly DecorationSelection[] } = {
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
  decorationSelections: [{ shotOrder: 1, assetRef: "arrow_right", anchor: "above_caption", scale: 1, animation: "fade" }],
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

interface InsightHarnessOptions {
  /** Frames the native layer publishes per asset. Absent means the plugin method is not available. */
  readonly frames?: (assetId: string) => readonly { readonly uri: string; readonly mimeType: string }[];
  /** What the vision model answers. Absent yields one usable description. */
  readonly vision?: () => Promise<{ readonly content: string; readonly reasoning: string }>;
}

interface V4HarnessOptions {
  /** What the text model drafts for `script_storyboard_v1`. Absent yields two grounded sentences. */
  readonly scriptDraft?: () => Record<string, unknown>;
  /** Stream events the provider stub replays per script-generation call (1-based) before answering. */
  readonly scriptStreamEvents?: (call: number) => readonly AiStreamEvent[];
  /** Duration of the single avatar video the picker returns; defaults to 20 s. */
  readonly avatarDurationSeconds?: number;
  /**
   * Per-call sentence outcomes from the native synthesis stage; `call` counts native invocations
   * so a retry can be scripted to succeed. Absent succeeds for every sentence on every call.
   */
  readonly narrationOutcomes?: (request: {
    readonly sentences: readonly { readonly sentenceId: string; readonly speechText: string; readonly needsTranscription?: boolean }[];
  }, call: number) => readonly { sentenceId: string; durationMs?: number; audioPath?: string; transcribedWords: null; error?: string }[];
  /** Overrides `getNarrationConnection`; absent leaves the port unwired (system-narration default). */
  readonly narrationConnection?: () => Promise<{
    readonly ttsTransport: string | null;
    readonly ttsModel: string | null;
    readonly ttsVoice: string | null;
    readonly baseUrl: string;
    readonly asrModel: string | null;
  } | null>;
}

function harness(narration: "system" | "provider" = "system", now?: () => Date, insight?: InsightHarnessOptions, v4?: V4HarnessOptions) {
  const values = new Map<string, string>();
  const ids = new Set<string>();
  const deletedPaths: string[] = [];
  const insightCalls: string[] = [];
  const visionPrompts: string[] = [];
  const pickCalls: Array<{ readonly projectId: string; readonly maxItems: number; readonly selection?: "visual" | "avatar" }> = [];
  const renderCalls: Array<{
    readonly projectId: string;
    readonly planJson: string;
    readonly mode?: "montage" | "avatar";
    readonly narration?: "system" | "provider";
    readonly miMoInstruction?: string;
    readonly stepFunInstruction?: string;
    readonly narrationAssets?: readonly { readonly sentenceId: string; readonly audioPath: string }[];
  }> = [];
  const planningPrompts: string[] = [];
  const scriptPrompts: string[] = [];
  const synthesizeCalls: Array<{ readonly projectId: string; readonly sentences: readonly { readonly sentenceId: string }[]; readonly narration: string }> = [];
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
      if (request.model === "vision") {
        visionPrompts.push(String(request.messages[0]?.content ?? ""));
        return insight?.vision?.() ?? {
          content: JSON.stringify({
            description: "店员在前台后面对着镜头说话，背后是货架",
            subject: "operator",
            tags: ["前台", "店员"],
            usable: true,
            unusableReason: null,
          }),
          reasoning: "",
        };
      }
      if (request.jsonSchema?.name === "script_storyboard_v1") {
        scriptPrompts.push(String(request.messages[0]?.content ?? ""));
        for (const event of v4?.scriptStreamEvents?.(scriptPrompts.length) ?? []) await request.onEvent?.(event);
        return {
          content: JSON.stringify(v4?.scriptDraft?.() ?? {
            purpose: "门店服务介绍",
            sentences: [
              { text: "先看看真实门店环境。", assetId: "asset-1" },
              { text: "再了解完整服务过程。", assetId: "asset-2" },
            ],
          }),
          reasoning: "",
        };
      }
      planningPrompts.push(String(request.messages[0]?.content ?? ""));
      return { content: JSON.stringify(plan), reasoning: "" };
    },
    transcribe: async () => "",
  };
  const native = {
    pickAssets: async (options: { readonly projectId: string; readonly maxItems: number; readonly selection?: "visual" | "avatar" }) => {
      pickCalls.push(options);
      return { assets: options.selection === "avatar" ? [
        { id: "avatar-1", uri: "file:///private/productions/project-1/inputs/avatar-1.mp4", role: "avatar" as const, kind: "video" as const, mimeType: "video/mp4", displayName: "数字人出镜.mp4", sizeBytes: 200, durationSeconds: v4?.avatarDurationSeconds ?? 20 },
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
      readonly narrationAssets?: readonly { readonly sentenceId: string; readonly audioPath: string }[];
    }) => {
      renderCalls.push(options);
      return { uri: "file:///private/productions/project-1/output.mp4", mimeType: "video/mp4" as const, sizeBytes: 1_024, durationSeconds: 20 };
    },
    consumeAssetOperation: async () => ({ status: "none" as const }),
    synthesizeNarration: async (request: {
      readonly projectId: string;
      readonly narration: string;
      readonly sentences: readonly { readonly sentenceId: string }[];
    }) => {
      synthesizeCalls.push({ projectId: request.projectId, sentences: request.sentences, narration: request.narration });
      const outcomes = v4?.narrationOutcomes?.(request as never, synthesizeCalls.length - 1);
      if (outcomes) return { sentences: outcomes };
      return {
        sentences: request.sentences.map((sentence, index) => ({
          sentenceId: sentence.sentenceId,
          durationMs: 4_000 + index * 1_000,
          audioPath: `narration/${sentence.sentenceId}.m4a`,
          transcribedWords: null,
        })),
      };
    },
    probeTts: async () => undefined,
    ...(insight?.frames
      ? {
        insightFrames: async ({ assetId }: { readonly projectId: string; readonly assetId: string }) => {
          insightCalls.push(assetId);
          return { frames: insight.frames!(assetId) };
        },
      }
      : {}),
  };
  const create = () => new StandaloneProductionService({
    files,
    native,
    analysis: { get: async () => analysis, run: async () => analysis, importVideo: async () => analysis, consumeVideoRecovery: async () => ({ status: "none" as const }), subscribe: () => () => undefined },
    tasks,
    getProvider: async () => provider,
    getNarrationMode: async () => narration,
    ...(v4?.narrationConnection ? { getNarrationConnection: v4.narrationConnection } : {}),
    toDisplayUri: (uri: string) => uri.replace("file:///private/", "capacitor://localhost/private/"),
    createProjectId: () => "project-1",
    now: now ?? (() => new Date("2026-08-08T00:00:00.000Z")),
  });
  return { create, values, ids, files, pickCalls, renderCalls, planningPrompts, scriptPrompts, synthesizeCalls, deletedPaths, insightCalls, visionPrompts };
}

/** Advances a second per persist so assertions can tell the writes apart by timestamp alone. */
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

function decorationsOf(record: { readonly plan?: { readonly document: unknown } }) {
  return (record.plan?.document as { readonly decorations?: readonly {
    readonly assetRef: string;
    readonly startMs: number;
    readonly endMs: number;
  }[] }).decorations ?? [];
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
  const beforePlan = context.values.get("project-1/plan.json");
  const statuses: string[] = [];
  service.subscribe("project-1", (event) => { if (event.type === "state") statuses.push(event.project.status); });

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
  assert.equal(context.values.get("project-1/plan.json"), beforePlan, "派生的 plan.json 不能领先于权威记录");
  assert.deepEqual(statuses, ["succeeded"], "微调没成功就不能先播一个 ready，让界面以为已经改好");
  const restored = await service.get("project-1");
  assert.equal(restored?.status, "succeeded", "回滚后仍是渲染完成，不能留在半成状态");
  assert.ok(restored?.output, "回滚后成片记录必须还在");
});

test("同一毫秒内的两次写入不会共用版本号，旧界面仍然被拦住", async () => {
  const frozen = () => new Date(Date.UTC(2026, 7, 8));
  const { service, ready } = await plannedProject(frozen);
  const staleUpdatedAt = ready.updatedAt;

  const first = await service.updatePlan("project-1", {
    expectedUpdatedAt: staleUpdatedAt,
    shots: [{ order: 1, narration: "第一次微调写进去的口播。" }],
  });
  assert.notEqual(first.updatedAt, staleUpdatedAt, "时钟不走也必须换一个版本号");

  await assert.rejects(
    () => service.updatePlan("project-1", {
      expectedUpdatedAt: staleUpdatedAt,
      shots: [{ order: 1, narration: "旧界面拿着老版本号覆盖。" }],
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "PRODUCTION_PLAN_VERSION_STALE");
      return true;
    },
  );

  const current = await service.get("project-1");
  assert.match(shotsOf(current!)[0]!.narration, /第一次微调/u, "第一次的修改必须留在盘上");
});

test("只有不可见字符的口播按空内容拒绝，不会烧进一条空字幕", async () => {
  const { service, ready, values } = await plannedProject(steppingClock());
  const before = values.get("project-1/project.json");

  for (const narration of ["\u200B\u200B\u200B", "\uFEFF \u00A0"]) {
    await assert.rejects(
      () => service.updatePlan("project-1", { expectedUpdatedAt: ready.updatedAt, shots: [{ order: 1, narration }] }),
      /口播内容不能为空/u,
    );
  }
  assert.equal(values.get("project-1/project.json"), before);
});

test("随包贴纸的白名单由服务传入，生成与微调都留得住装饰", async () => {
  const { service, ready } = await plannedProject(steppingClock());

  // Without `allowedDecorationIds` the allow-list is empty, every selection fails validation and
  // generatePlan throws — so reaching `ready` at all is part of the assertion.
  const generated = decorationsOf(ready);
  assert.equal(generated.length, 1);
  assert.equal(generated[0]!.assetRef, "arrow_right");
  assert.ok(DECORATION_IDS.includes(generated[0]!.assetRef), "只能是随包清单里的 id");

  // Timing is derived here, not answered by the model, so it must land inside the shot it belongs to.
  const firstShot = shotsOf(ready)[0]!;
  assert.ok(generated[0]!.startMs >= 0);
  assert.ok(generated[0]!.endMs <= Math.round(firstShot.durationSeconds * 1_000));
  assert.ok(generated[0]!.endMs > generated[0]!.startMs);

  // A micro-edit re-derives the window; it must not silently drop the sticker.
  const edited = await service.updatePlan("project-1", {
    expectedUpdatedAt: ready.updatedAt,
    shots: [{ order: 1, narration: "先看看真实环境，再看服务过程。" }],
  });
  assert.equal(decorationsOf(edited).length, 1, "微调不得把装饰清空");
  assert.equal(decorationsOf(edited)[0]!.assetRef, "arrow_right");
});

test("取消背景音乐时同时设置音量按冲突拒绝，而不是默默改成静音", async () => {
  const { service, ready } = await plannedProject(steppingClock());
  await assert.rejects(
    () => service.updatePlan("project-1", { expectedUpdatedAt: ready.updatedAt, backgroundMusicAssetId: null, backgroundMusicVolume: 0.2 }),
    /取消背景音乐时不能同时设置音量/u,
  );
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
      synthesizeNarration: async () => ({ sentences: [] }),
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
      synthesizeNarration: async () => ({ sentences: [] }),
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
    native: { pickAssets: async () => ({ assets: [] }), consumeAssetOperation: async () => ({ status: "none" as const }), render: async () => { throw new Error("unused"); }, probeTts: async () => undefined, synthesizeNarration: async () => ({ sentences: [] }) },
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
    native: { pickAssets: async () => ({ assets: [] }), consumeAssetOperation: async () => ({ status: "none" as const }), render: async () => { throw new Error("unused"); }, probeTts: async () => undefined, synthesizeNarration: async () => ({ sentences: [] }) },
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
    native: { pickAssets: async () => ({ assets: [] }), consumeAssetOperation: async () => ({ status: "none" as const }), render: async () => { throw new Error("unused"); }, probeTts: async () => undefined, synthesizeNarration: async () => ({ sentences: [] }) },
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

test("制作项目 list 与 get 会恢复 SPA 内卡住的渲染和规划", async () => {
  const { create, values } = harness();
  const service = create();
  await service.create({ analysisTaskId: "task-1", brief: "真实门店", targetDurationSeconds: 20 });
  await service.importAssets("project-1");
  await service.generatePlan("project-1");
  const stored = JSON.parse(values.get("project-1/project.json") ?? "{}") as Record<string, unknown>;
  values.set("project-1/project.json", JSON.stringify({ ...stored, status: "rendering" }));

  assert.equal((await service.inspectUnfinishedWork()).length, 1);
  const listed = await service.list();
  assert.equal(listed[0]?.status, "failed");
  assert.equal(listed[0]?.issue?.code, "TASK_INTERRUPTED");
  assert.equal(listed[0]?.assets.length, 3);
  assert.equal((await service.inspectUnfinishedWork()).length, 0);

  const afterList = JSON.parse(values.get("project-1/project.json") ?? "{}") as Record<string, unknown>;
  values.set("project-1/project.json", JSON.stringify({ ...afterList, status: "planning" }));
  const opened = await service.get("project-1");
  assert.equal(opened?.status, "failed");
  assert.equal(opened?.issue?.code, "TASK_INTERRUPTED");
});

test("正在渲染时 list 与 recover 不得把项目标成中断", async () => {
  const values = new Map<string, string>();
  const ids = new Set<string>();
  const renderEntered = deferred();
  const renderRelease = deferred();
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
      pickAssets: async () => ({ assets: [
        { id: "asset-1", uri: "file:///private/a.jpg", kind: "image", mimeType: "image/jpeg", displayName: "a.jpg", sizeBytes: 100 },
        { id: "asset-2", uri: "file:///private/b.mp4", kind: "video", mimeType: "video/mp4", displayName: "b.mp4", sizeBytes: 200 },
        { id: "asset-3", uri: "file:///private/c.png", kind: "image", mimeType: "image/png", displayName: "c.png", sizeBytes: 100 },
      ] }),
      render: async () => {
        renderEntered.resolve();
        await renderRelease.promise;
        return { uri: "file:///private/output.mp4", mimeType: "video/mp4", sizeBytes: 1_024, durationSeconds: 20 };
      },
      consumeAssetOperation: async () => ({ status: "none" as const }),
      probeTts: async () => undefined,
      synthesizeNarration: async () => ({ sentences: [] }),
    },
    analysis: { get: async () => analysis, run: async () => analysis, importVideo: async () => analysis, consumeVideoRecovery: async () => ({ status: "none" as const }), subscribe: () => () => undefined },
    tasks,
    getProvider: async () => ({ generate: async () => ({ content: JSON.stringify(plan), reasoning: "" }), transcribe: async () => "" }),
    getNarrationMode: async () => "system",
    toDisplayUri: (uri) => uri,
    createProjectId: () => "project-live",
  });

  await service.create({ analysisTaskId: "task-1", brief: "真实制作", targetDurationSeconds: 20 });
  await service.importAssets("project-live");
  await service.generatePlan("project-live");
  const rendering = service.render("project-live");
  await renderEntered.promise;

  assert.equal((await service.inspectUnfinishedWork()).length, 1);
  assert.equal((await service.recoverInterruptedWork()).length, 0);
  assert.equal((await service.get("project-live"))?.status, "rendering");
  assert.equal((await service.list())[0]?.status, "rendering");

  renderRelease.resolve();
  assert.equal((await rendering).status, "succeeded");
  assert.equal((await service.get("project-live"))?.status, "succeeded");
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
      synthesizeNarration: async () => ({ sentences: [] }),
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

test("计划无法读取时项目仍可见、可重新生成、可删除", async () => {
  const { create, values, ids } = harness();
  const service = create();
  await service.create({ analysisTaskId: "task-1", brief: "真实门店", targetDurationSeconds: 20 });
  await service.importAssets("project-1");
  await service.generatePlan("project-1");
  await service.render("project-1");
  const stored = JSON.parse(values.get("project-1/project.json") ?? "{}") as Record<string, unknown>;
  values.set("project-1/project.json", JSON.stringify({
    ...stored,
    plan: { schemaVersion: "production-plan.v3" },
  }));

  const listed = await service.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.status, "failed");
  assert.equal(listed[0]?.plan, undefined);
  assert.equal(listed[0]?.assets.length, 3);
  assert.ok(listed[0]?.output);
  assert.equal(listed[0]?.issue?.code, "PRODUCTION_PLAN_UNREADABLE");
  assert.equal(listed[0]?.issue?.action, "retry");
  assert.equal(JSON.parse(values.get("project-1/project.json") ?? "{}").plan, undefined, "损坏计划必须从磁盘拿掉，不能假装还可用");

  const regenerated = await service.generatePlan("project-1");
  assert.equal(regenerated.status, "ready");
  assert.equal(regenerated.plan?.schemaVersion, "production-plan.v3");
  assert.equal(regenerated.issue, undefined);

  values.set("project-1/project.json", JSON.stringify({
    ...JSON.parse(values.get("project-1/project.json") ?? "{}"),
    plan: { schemaVersion: "not-a-plan" },
  }));
  await service.delete("project-1");
  assert.equal(ids.has("project-1"), false);
  assert.equal((await service.list()).length, 0);
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

test("数字人项目不再要求口播稿；存量口播稿项目仍走 v3 原声字幕计划", async () => {
  const { create, pickCalls } = harness();
  const service = create();

  // v4 语义：脚本由 AI 按需求生成，创建数字人项目不需要口播稿。
  const scriptless = await service.create({ analysisTaskId: "task-1", brief: "自然介绍门店", targetDurationSeconds: 20, mode: "avatar" });
  assert.equal(scriptless.mode, "avatar");
  // 旧 v3 路径（逐字稿口播切片）没有脚本就不能生成计划——这是存量行为的边界，不是新项目的入口。
  await assert.rejects(() => service.generatePlan(scriptless.projectId), /口播稿/u);

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
      synthesizeNarration: async () => ({ sentences: [] }),
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
    ["ERR_DECORATION_ASSET_MISSING", "PRODUCTION_DECORATION_MISSING", "none"],
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
        synthesizeNarration: async () => ({ sentences: [] }),
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
      synthesizeNarration: async () => ({ sentences: [] }),
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

test("consume 返回 none 时保留待绑定标记，以免清掉仍在进行的外部选择", async () => {
  const { create, values } = harness();
  const created = create();
  await created.create({ analysisTaskId: "task-1", brief: "真实门店", targetDurationSeconds: 20 });
  const stored = JSON.parse(values.get("project-1/project.json")!) as Record<string, unknown>;
  values.set("project-1/project.json", JSON.stringify({ ...stored, pendingRequirementOrder: 3 }));
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
      render: async () => { throw new Error("unused"); },
      probeTts: async () => undefined,
      synthesizeNarration: async () => ({ sentences: [] }),
    },
    analysis: { get: async () => analysis, run: async () => analysis, importVideo: async () => analysis, consumeVideoRecovery: async () => ({ status: "none" as const }), subscribe: () => () => undefined },
    tasks,
    getProvider: async () => ({ generate: async () => ({ content: JSON.stringify(plan), reasoning: "" }), transcribe: async () => "" }),
    getNarrationMode: async () => "system",
    toDisplayUri: (uri) => uri,
  });

  const recovered = await service.consumeAssetRecovery();

  assert.equal(recovered.status, "none");
  assert.equal(
    (JSON.parse(values.get("project-1/project.json")!) as Record<string, unknown>).pendingRequirementOrder,
    3,
    "原生 none 同时表示「选择器还开着」和「这次选择已经没了」，清掉会让即将返回的文件对不上清单项",
  );
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
        synthesizeNarration: async () => ({ sentences: [] }),
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

const FRAMES = [
  { uri: "file:///private/productions/project-1/insight/asset-1-0.jpg", mimeType: "image/jpeg" },
] as const;

function planOf(record: { readonly plan?: { readonly document: unknown } }) {
  return record.plan?.document as {
    readonly grounding?: { readonly visual: string; readonly describedAssetIds: readonly string[] };
  };
}

test("看过素材时计划记下是哪几个，画面描述进提示词但私有路径不进", async () => {
  const context = harness("system", undefined, { frames: () => FRAMES });
  const service = context.create();
  await service.create({ analysisTaskId: "task-1", brief: "突出真实服务", targetDurationSeconds: 20 });
  await service.importAssets("project-1");

  const ready = await service.generatePlan("project-1");

  assert.deepEqual(context.insightCalls, ["asset-1", "asset-2", "asset-3"], "每个画面素材各看一次，串行执行");
  assert.deepEqual(planOf(ready).grounding, {
    visual: "asset_insight",
    describedAssetIds: ["asset-1", "asset-2", "asset-3"],
  });
  const prompt = context.planningPrompts.at(-1) ?? "";
  assert.match(prompt, /店员在前台后面对着镜头说话/u, "画面描述必须真的送进规划");
  assert.doesNotMatch(prompt, /file:\/\/\//u, "素材的私有文件路径不该送给模型");
  assert.doesNotMatch(prompt, /sizeBytes/u, "落盘字节数对写脚本没用，也不该送出去");
});

test("看不到画面的每一种原因都退回盲配，不阻塞成片也不编描述", async () => {
  const cases: ReadonlyArray<readonly [string, InsightHarnessOptions]> = [
    ["原生没有这个能力（旧 APK 或浏览器）", {}],
    ["抽不出帧", { frames: () => [] }],
    ["视觉模型没配好", { frames: () => FRAMES, vision: async () => { throw new TaskError({ code: "AI_VISION_UNAVAILABLE", message: "没有视觉能力", action: "configure_ai" }); } }],
    ["模型返回坏 JSON", { frames: () => FRAMES, vision: async () => ({ content: "{不是 JSON", reasoning: "" }) }],
    ["模型说看不清", { frames: () => FRAMES, vision: async () => ({ content: JSON.stringify({ description: "画面几乎全黑", subject: "other", tags: [], usable: false, unusableReason: "太暗了，建议开灯重拍" }), reasoning: "" }) }],
  ];

  for (const [label, options] of cases) {
    const context = harness("system", undefined, options);
    const service = context.create();
    await service.create({ analysisTaskId: "task-1", brief: "突出真实服务", targetDurationSeconds: 20 });
    await service.importAssets("project-1");

    const ready = await service.generatePlan("project-1");

    assert.equal(ready.status, "ready", `${label}：不得阻塞制作`);
    assert.deepEqual(planOf(ready).grounding, { visual: "blind", describedAssetIds: [] }, label);
    assert.match(context.planningPrompts.at(-1) ?? "", /没有任何素材的画面被识别过/u, label);
  }
});

test("已经看过的素材不会在重新规划时再花一次视觉调用", async () => {
  const context = harness("system", steppingClock(), { frames: () => FRAMES });
  const service = context.create();
  await service.create({ analysisTaskId: "task-1", brief: "突出真实服务", targetDurationSeconds: 20 });
  await service.importAssets("project-1");
  await service.generatePlan("project-1");

  // A reload proves the cached observation survives in project.json rather than living in memory.
  const reopened = context.create();
  const again = await reopened.generatePlan("project-1");

  assert.deepEqual(context.insightCalls, ["asset-1", "asset-2", "asset-3"], "第二次规划不该重新抽帧");
  assert.equal(context.visionPrompts.length, 3, "第二次规划不该重新调用视觉模型");
  assert.equal(planOf(again).grounding?.visual, "asset_insight");
});

test("看不清的素材把重拍建议交到界面，而不是只留一句盲配", async () => {
  const context = harness("system", undefined, {
    frames: () => FRAMES,
    vision: async () => ({
      content: JSON.stringify({ description: "画面几乎全黑，看不出主体", subject: "other", tags: [], usable: false, unusableReason: "太暗了，建议开灯后重拍" }),
      reasoning: "",
    }),
  });
  const service = context.create();
  await service.create({ analysisTaskId: "task-1", brief: "突出真实服务", targetDurationSeconds: 20 });
  await service.importAssets("project-1");

  const ready = await service.generatePlan("project-1");

  assert.equal(planOf(ready).grounding?.visual, "blind", "看过但没看清不算已识别");
  assert.deepEqual(ready.assets.map((asset) => asset.reshootAdvice), ["太暗了，建议开灯后重拍", "太暗了，建议开灯后重拍", "太暗了，建议开灯后重拍"]);
  // Only the advice crosses over: the description behind it is a planning input, and showing it
  // would suggest the app checked the material against the shooting list.
  assert.equal(JSON.stringify(ready.assets).includes("画面几乎全黑"), false);
});

test("数字人口播不去看素材，计划记成与画面匹配无关", async () => {
  const context = harness("system", undefined, { frames: () => FRAMES });
  const service = context.create();
  await service.create({ analysisTaskId: "task-1", brief: "数字人口播", targetDurationSeconds: 20, mode: "avatar", avatarScript: "欢迎来到我们的门店，今天带你看看真实的服务过程。" });
  await service.importAssets("project-1");

  const ready = await service.generatePlan("project-1");

  assert.deepEqual(context.insightCalls, [], "口播稿是用户自己写的，没有画面要匹配");
  assert.deepEqual(planOf(ready).grounding, { visual: "not_applicable", describedAssetIds: [] });
});

// ============================ v4（文稿先行）管线 ============================

function scriptSentencesOf(record: { readonly storyboard: { readonly document: unknown } }) {
  return (record.storyboard.document as {
    readonly sentences: readonly { readonly id: string; readonly text: string; readonly assetId?: string; readonly estimatedMs: number }[];
  }).sentences;
}

/** 走到「已生成分镜脚本」的公共前置；返回的 service 已持有两句话的分镜。 */
async function scriptedProject(v4?: V4HarnessOptions) {
  const context = harness("system", undefined, undefined, v4);
  const service = context.create();
  await service.create({ analysisTaskId: "task-1", brief: "突出真实服务", targetDurationSeconds: 20 });
  await service.importAssets("project-1");
  const script = await service.generateScript("project-1");
  return { ...context, service, script };
}

test("分镜脚本生成本地 id 与字符估算，重启后仍可读取", async () => {
  const { service, script, scriptPrompts, create } = await scriptedProject();

  assert.equal(script.schemaVersion, "production-script.v1");
  const sentences = scriptSentencesOf(script);
  assert.equal(sentences.length, 2);
  assert.deepEqual(sentences.map((sentence) => sentence.text), ["先看看真实门店环境。", "再了解完整服务过程。"]);
  assert.deepEqual(sentences.map((sentence) => sentence.assetId), ["asset-1", "asset-2"], "草稿的素材绑定建议必须原样带进契约");
  assert.ok(sentences.every((sentence) => /^[A-Za-z0-9_-]+$/u.test(sentence.id)), "句子 id 由本地生成，不来自模型");
  assert.ok(sentences.every((sentence) => sentence.estimatedMs === [...sentence.text].length * 250), "预估时长按字符估算，不问模型要毫秒");
  assert.equal(script.estimatedTotalMs, sentences.reduce((sum, sentence) => sum + sentence.estimatedMs, 0));
  assert.match(scriptPrompts.at(-1) ?? "", /突出真实服务/u);
  assert.equal((await service.get("project-1"))?.status, "draft", "脚本生成后项目停在草稿，不伪装成就绪");

  // 重启后从 project.json 读回：脚本是持久化事实，不活在内存里。
  const reopened = create();
  const reread = await reopened.getScript("project-1");
  assert.deepEqual(scriptSentencesOf(reread!), sentences);
});

test("分镜生成流式增量聚合成 script-progress 事件，正文与推理分开携带", async () => {
  const context = harness("system", undefined, undefined, {
    scriptStreamEvents: () => [
      { type: "reasoning_delta", delta: "先想结构" },
      { type: "content_delta", delta: "第一段" },
      { type: "content_delta", delta: "第二段" },
      { type: "completed" },
    ],
  });
  const service = context.create();
  await service.create({ analysisTaskId: "task-1", brief: "突出真实服务", targetDurationSeconds: 20 });
  await service.importAssets("project-1");

  const progress: StandaloneProductionEvent[] = [];
  const stop = service.subscribe("project-1", (event) => { progress.push(event); });
  try {
    await service.generateScript("project-1");
  } finally {
    stop();
  }

  // 短于 48 字且不足 120ms 时不分片：completed 一次性冲刷全部增量。
  const streamed = progress.filter((event) => event.type === "script-progress");
  assert.equal(streamed.length, 1, "小流量增量应合并为单次事件，避免逐字轰炸界面");
  assert.deepEqual(
    streamed[0],
    { type: "script-progress", projectId: "project-1", phase: "generating", contentDelta: "第一段第二段", reasoningDelta: "先想结构", receivedCharacters: 6 },
  );
  assert.ok(!JSON.stringify(context.values).includes("先想结构"), "推理增量是运行期内存事件，绝不落盘");
});

test("初稿触发修复轮时先冲刷 generating 增量，再以 repairing 阶段继续", async () => {
  let call = 0;
  const context = harness("system", undefined, undefined, {
    scriptDraft: () => {
      call += 1;
      return call === 1
        ? { purpose: "初稿", sentences: [{ text: "看门店。", assetId: "asset-9" }] }
        : { purpose: "门店服务介绍", sentences: [{ text: "先看看真实门店环境。", assetId: "asset-1" }, { text: "再了解完整服务过程。", assetId: "asset-2" }] };
    },
    scriptStreamEvents: (which) => which === 1
      ? [{ type: "content_delta", delta: "初稿增量" }]
      : [{ type: "content_delta", delta: "修复增量" }, { type: "completed" }],
  });
  const service = context.create();
  await service.create({ analysisTaskId: "task-1", brief: "突出真实服务", targetDurationSeconds: 20 });
  await service.importAssets("project-1");

  const progress: StandaloneProductionEvent[] = [];
  const stop = service.subscribe("project-1", (event) => { progress.push(event); });
  try {
    await service.generateScript("project-1");
  } finally {
    stop();
  }

  const streamed = progress.filter((event) => event.type === "script-progress");
  // 阶段切换本身要冲刷：初稿增量不能被错误地标成 repairing。
  assert.deepEqual(
    streamed.map((event) => [event.phase, event.contentDelta, event.receivedCharacters]),
    [["generating", "初稿增量", 4], ["repairing", "修复增量", 8]],
    "receivedCharacters 跨阶段单调递增，不因冲刷归零",
  );
});

test("重新生成分镜会作废旧句子上的配音、计划与成片", async () => {
  const { service, script, deletedPaths } = await scriptedProject();
  await service.synthesizeNarration("project-1");
  await service.composeMeasuredPlan("project-1");
  await service.render("project-1");

  const regenerated = await service.generateScript("project-1", { brief: "换个说法介绍门店服务" });

  const oldIds = new Set(scriptSentencesOf(script).map((sentence) => sentence.id));
  const newSentences = scriptSentencesOf(regenerated);
  assert.ok(newSentences.every((sentence) => !oldIds.has(sentence.id)), "重新生成必须换发新句子 id，旧配音才不会错挂");
  assert.ok(deletedPaths.includes("output.mp4"), "旧成片对不上新脚本，必须删掉而不是继续展示");
  assert.equal(deletedPaths.filter((path) => path.startsWith("narration/")).length, 2, "两句旧配音音频都要清理");
  const project = await service.get("project-1");
  assert.equal(project?.plan, undefined);
  assert.equal(project?.output, undefined);
  const narration = await service.getNarration("project-1");
  assert.deepEqual(narration?.sentences.map((sentence) => sentence.status), ["missing", "missing"], "脚本已换，旧配音不跟到新句子上：每句都要重新合成");
  assert.ok(narration?.sentences.every((sentence) => newSentences.some((fresh) => fresh.id === sentence.sentenceId)));
});

test("逐句配音持久化实测音轨并可在重启后读回", async () => {
  const { service, synthesizeCalls, create } = await scriptedProject();

  const record = await service.synthesizeNarration("project-1");

  assert.equal(record.schemaVersion, "production-narration.v1");
  assert.equal(record.mode, "system");
  assert.equal(synthesizeCalls.length, 1);
  assert.equal(synthesizeCalls[0]?.sentences.length, 2, "缺省补齐所有未就绪句子");
  assert.deepEqual(record.sentences.map((sentence) => sentence.status), ["ready", "ready"]);
  assert.equal(record.totalDurationMs, 9_000);
  assert.ok(record.sentences.every((sentence) => sentence.durationMs !== undefined && sentence.alignmentSource === "whisper_fallback"));

  const reopened = create();
  const reread = await reopened.getNarration("project-1");
  assert.deepEqual(reread?.sentences.map((sentence) => [sentence.sentenceId, sentence.status]), record.sentences.map((sentence) => [sentence.sentenceId, sentence.status]), "实测音轨是持久化事实，重启不丢");
});

test("单句失败不拖垮其余句子，重试只补失败的那句", async () => {
  const { service, script, synthesizeCalls } = await scriptedProject({
    narrationOutcomes: (request, call) => request.sentences.map((sentence, index) => call === 0 && index === 0
      ? { sentenceId: sentence.sentenceId, transcribedWords: null, error: "ERR_TTS_SYNTHESIS_FAILED" }
      : { sentenceId: sentence.sentenceId, durationMs: 5_000, audioPath: `narration/${sentence.sentenceId}.m4a`, transcribedWords: null }),
  });

  const partial = await service.synthesizeNarration("project-1");

  const failedId = scriptSentencesOf(script)[0]!.id;
  assert.equal(partial.sentences[0]?.status, "missing");
  assert.equal(partial.sentences[1]?.status, "ready");
  assert.deepEqual(partial.failures.map((failure) => [failure.sentenceId, failure.issue.code]), [[failedId, "TTS_SYNTHESIS_FAILED"]]);
  assert.equal((await service.get("project-1"))?.status, "draft", "部分成功不是项目失败，界面按句引导重试");

  const recovered = await service.synthesizeNarration("project-1", { sentenceIds: [failedId] });

  assert.equal(synthesizeCalls.at(-1)?.sentences.length, 1, "单句重试只把失败句送去合成，成功句不重花一次语音");
  assert.equal(synthesizeCalls.at(-1)?.sentences[0]?.sentenceId, failedId);
  assert.ok(recovered.sentences.every((sentence) => sentence.status === "ready"));
  assert.equal(recovered.failures.length, 0);
});

test("全部句子失败时项目进入失败终态并携带可行动的 issue", async () => {
  const { service } = await scriptedProject({
    narrationOutcomes: (request, call) => call === 0
      ? request.sentences.map((sentence) => ({ sentenceId: sentence.sentenceId, transcribedWords: null, error: "ERR_TTS_SYNTHESIS_FAILED" }))
      : request.sentences.map((sentence, index) => ({ sentenceId: sentence.sentenceId, durationMs: 4_000 + index * 1_000, audioPath: `narration/${sentence.sentenceId}.m4a`, transcribedWords: null })),
  });

  const record = await service.synthesizeNarration("project-1");

  assert.ok(record.sentences.every((sentence) => sentence.status === "missing"));
  assert.equal(record.failures.length, 2);
  const project = await service.get("project-1");
  assert.equal(project?.status, "failed");
  assert.equal(project?.issue?.code, "TTS_SYNTHESIS_FAILED");
  assert.equal(project?.issue?.action, "retry");

  const recovered = await service.synthesizeNarration("project-1");
  assert.ok(recovered.sentences.every((sentence) => sentence.status === "ready"));
  assert.equal((await service.get("project-1"))?.status, "draft", "重试成功后离开失败终态，不永远卡在失败");
});

test("配音未补齐不能组装计划；补齐后组装 v4 计划、渲染消费实测音频", async () => {
  const { service, renderCalls } = await scriptedProject();

  await assert.rejects(() => service.composeMeasuredPlan("project-1"), /配音/u);

  const composed = await service.synthesizeNarration("project-1").then(() => service.composeMeasuredPlan("project-1"));

  assert.equal(composed.schemaVersion, "production-measured-plan.v1");
  assert.equal(composed.project.status, "ready");
  assert.equal(composed.project.plan?.schemaVersion, "production-plan.v4");
  const shots = shotsOf(composed.project) as unknown as readonly { readonly sentenceId?: string; readonly durationMs?: number }[];
  assert.deepEqual(shots.map((shot) => shot.durationMs), [4_000, 5_000], "每镜时长等于对应句的实测音频时长");
  assert.ok(composed.softViolations.some((violation) => violation.reason === "total-too-short"), "九秒总时长低于 15 秒软边界，必须提示而不是拒绝");

  const rendered = await service.render("project-1");
  assert.equal(rendered.status, "succeeded");
  assert.equal(renderCalls[0]?.narrationAssets?.length, 2, "v4 渲染消费已持久化的逐句音频");
  assert.ok(renderCalls[0]?.narrationAssets?.every((asset) => asset.audioPath.startsWith("narration/")));
});

/** 走到「数字人 v4 已生成脚本」的公共前置：单段数字人视频，草稿两句都绑 avatar-1。 */
async function avatarScriptedProject(v4?: V4HarnessOptions) {
  const context = harness("system", undefined, undefined, {
    scriptDraft: () => ({
      purpose: "门店服务介绍",
      sentences: [
        { text: "先看看真实门店环境。", assetId: "avatar-1" },
        { text: "再了解完整服务过程。", assetId: "avatar-1" },
      ],
    }),
    ...v4,
  });
  const service = context.create();
  await service.create({ analysisTaskId: "task-1", brief: "数字人介绍门店", targetDurationSeconds: 20, mode: "avatar" });
  await service.importAssets("project-1");
  const script = await service.generateScript("project-1");
  return { ...context, service, script };
}

function avatarShotsOf(record: { readonly plan?: { readonly document: unknown } }) {
  return (record.plan?.document as { readonly shots: readonly {
    readonly durationMs: number;
    readonly sourceWindows?: readonly { readonly startMs: number; readonly endMs: number }[];
  }[] }).shots;
}

test("数字人 v4：单视频画面窗口按实测配音烘焙进计划并渲染", async () => {
  const { service, renderCalls } = await avatarScriptedProject();
  await service.synthesizeNarration("project-1");

  const composed = await service.composeMeasuredPlan("project-1");

  assert.equal(composed.project.plan?.schemaVersion, "production-plan.v4");
  const shots = avatarShotsOf(composed.project);
  assert.deepEqual(shots.map((shot) => shot.durationMs), [4_000, 5_000]);
  // 20 秒源顺序消费：第一镜 [0,4000]，第二镜接着消费 [4000,9000]，不回绕。
  assert.deepEqual(shots[0]?.sourceWindows, [{ startMs: 0, endMs: 4_000 }]);
  assert.deepEqual(shots[1]?.sourceWindows, [{ startMs: 4_000, endMs: 9_000 }]);
  assert.equal(composed.softViolations.some((violation) => violation.reason === "avatar-source-short"), false, "20 秒源不算偏短");

  const rendered = await service.render("project-1");
  assert.equal(rendered.status, "succeeded");
  assert.equal(renderCalls[0]?.mode, "avatar");
  assert.equal(renderCalls[0]?.narrationAssets?.length, 2, "数字人成片配音来自我们自己的逐句 TTS");
  assert.match(renderCalls[0]?.planJson ?? "", /sourceWindows/u, "窗口随计划交给端侧渲染器消费");
});

test("数字人源视频短于配音也能组装：窗口回绕拼接并提示源偏短", async () => {
  const { service } = await avatarScriptedProject({ avatarDurationSeconds: 4 });
  await service.synthesizeNarration("project-1");

  const composed = await service.composeMeasuredPlan("project-1");

  const shots = avatarShotsOf(composed.project);
  // 4 秒源 + 9 秒配音：第一镜吃满整段 [0,4000]；第二镜 5 秒回绕拼 [0,4000]+[0,1000]。
  assert.deepEqual(shots[0]?.sourceWindows, [{ startMs: 0, endMs: 4_000 }]);
  assert.deepEqual(shots[1]?.sourceWindows, [{ startMs: 0, endMs: 4_000 }, { startMs: 0, endMs: 1_000 }]);
  const short = composed.softViolations.find((violation) => violation.reason === "avatar-source-short");
  assert.equal(short?.sourceDurationMs, 4_000, "源偏短是软违规提示，不阻塞组装");
});

test("数字人源视频不足2秒直接拒绝组装", async () => {
  const { service } = await avatarScriptedProject({ avatarDurationSeconds: 1.5 });
  await service.synthesizeNarration("project-1");

  await assert.rejects(() => service.composeMeasuredPlan("project-1"), /不足2秒/u);
  assert.equal((await service.get("project-1"))?.status, "draft", "拒绝发生在写计划之前，项目状态不被污染");
});

test("v4 计划缺任何一句音频都拒绝渲染，且不先进入渲染中状态", async () => {
  const { service, values, renderCalls } = await scriptedProject();
  await service.synthesizeNarration("project-1");
  await service.composeMeasuredPlan("project-1");

  // 模拟记录损坏：从磁盘上抠掉第二句的音频文件记录，只留音轨。
  const stored = JSON.parse(values.get("project-1/project.json")!) as { narrationAssets: { sentenceId: string }[] };
  values.set("project-1/project.json", JSON.stringify({ ...stored, narrationAssets: stored.narrationAssets.slice(0, 1) }));

  await assert.rejects(() => service.render("project-1"), /配音/u);
  assert.equal(renderCalls.length, 0, "音频不齐就不该把计划送进渲染器");
  assert.equal((await service.get("project-1"))?.status, "ready", "拒绝发生在进入渲染中之前，项目状态不被污染");
});

test("重合成已进计划的句子会让计划与成片立即过期", async () => {
  const { service, script, deletedPaths } = await scriptedProject();
  await service.synthesizeNarration("project-1");
  await service.composeMeasuredPlan("project-1");
  await service.render("project-1");

  const resynthesized = await service.synthesizeNarration("project-1", { sentenceIds: [scriptSentencesOf(script)[0]!.id] });

  assert.ok(resynthesized.sentences.every((sentence) => sentence.status === "ready"));
  const project = await service.get("project-1");
  assert.equal(project?.plan, undefined, "计划时间轴锚定旧实测时长，句子变了就不能继续展示");
  assert.equal(project?.output, undefined);
  assert.ok(deletedPaths.includes("output.mp4"), "过期成片要删，避免界面把旧产物当成新计划的结果");
});

test("旧版逐镜秒数微调对分镜项目拒绝，指向阶段页回改文稿", async () => {
  const { service } = await scriptedProject();
  await service.synthesizeNarration("project-1");
  const { project } = await service.composeMeasuredPlan("project-1");

  await assert.rejects(
    () => service.updatePlan("project-1", { expectedUpdatedAt: project.updatedAt, shots: [{ order: 1, durationSeconds: 5 }] }),
    (error: unknown) => error instanceof TaskError && error.code === "PRODUCTION_PLAN_EDIT_INVALID",
  );
});

test("逐句编辑只作废被改句的配音，计划与成片随之失效、句子 id 保持稳定", async () => {
  const { service, script, deletedPaths } = await scriptedProject();
  await service.synthesizeNarration("project-1");
  await service.composeMeasuredPlan("project-1");
  await service.render("project-1");

  const sentences = scriptSentencesOf(script);
  const firstId = sentences[0]!.id;
  const edited = await service.updateStoryboard("project-1", {
    expectedUpdatedAt: (await service.get("project-1"))!.updatedAt,
    sentences: [{ sentenceId: firstId, text: "先看看焕新后的门店环境。", assetId: "asset-3", stickerId: null }],
  });

  const editedSentences = scriptSentencesOf(edited);
  assert.deepEqual(editedSentences.map((sentence) => sentence.id), sentences.map((sentence) => sentence.id), "编辑不换发句子 id，未改句的配音才能继续挂住");
  assert.equal(editedSentences[0]?.text, "先看看焕新后的门店环境。");
  assert.equal(editedSentences[0]?.assetId, "asset-3");
  assert.equal(editedSentences[0]?.estimatedMs, [..."先看看焕新后的门店环境。"].length * 250, "改文案后按新字符数重算预估");
  assert.equal(editedSentences[1]?.assetId, sentences[1]?.assetId, "未提交的句子原样保留");

  const narration = await service.getNarration("project-1");
  assert.equal(narration?.sentences[0]?.status, "missing", "改了文案的句子必须重新配音");
  assert.equal(narration?.sentences[1]?.status, "ready", "其余句的实测配音保持就绪，不陪着重来");
  assert.ok(deletedPaths.some((path) => path === `narration/${firstId}.m4a`), "被改句的旧音频文件要清理");
  assert.ok(deletedPaths.includes("output.mp4"), "计划与成片由脚本派生，脚本变了就作废");
  const project = await service.get("project-1");
  assert.equal(project?.plan, undefined);
  assert.equal(project?.output, undefined);
  assert.equal(project?.status, "draft", "回改后回到草稿，由阶段页引导补配音再重新组装");
});

test("逐句编辑拒绝未知句子、超长文案、无效素材绑定与过期版本", async () => {
  const { service, script } = await scriptedProject();
  await service.synthesizeNarration("project-1");
  const project = await service.get("project-1");
  const firstId = scriptSentencesOf(script)[0]!.id;

  await assert.rejects(() => service.updateStoryboard("project-1", {
    expectedUpdatedAt: project!.updatedAt,
    sentences: [{ sentenceId: "not-in-script", text: "新文案" }],
  }), /不在分镜脚本/u);
  await assert.rejects(() => service.updateStoryboard("project-1", {
    expectedUpdatedAt: project!.updatedAt,
    sentences: [{ sentenceId: firstId, text: "超".repeat(161) }],
  }), /160 字上限/u);
  await assert.rejects(() => service.updateStoryboard("project-1", {
    expectedUpdatedAt: project!.updatedAt,
    sentences: [{ sentenceId: firstId, assetId: "not-an-asset" }],
  }), /项目内已导入/u);
  await assert.rejects(() => service.updateStoryboard("project-1", {
    expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    sentences: [{ sentenceId: firstId, text: "新文案" }],
  }), /已被更新/u);
  assert.deepEqual(
    scriptSentencesOf((await service.getScript("project-1"))!).map((sentence) => sentence.text),
    scriptSentencesOf(script).map((sentence) => sentence.text),
    "全部拒绝路径都不落盘，脚本保持原样",
  );
});

test("云端配音连接不完整时按稳定错误拒绝，而不是静默退回系统语音", async () => {
  const context = harness("provider", undefined, undefined, {
    narrationConnection: async () => ({ ttsTransport: null, ttsModel: null, ttsVoice: null, baseUrl: "https://api.example.com", asrModel: null }),
  });
  const service = context.create();
  await service.create({ analysisTaskId: "task-1", brief: "突出真实服务", targetDurationSeconds: 20 });
  await service.importAssets("project-1");
  await service.generateScript("project-1");

  await assert.rejects(
    () => service.synthesizeNarration("project-1"),
    (error: unknown) => error instanceof TaskError && error.code === "TTS_UNAVAILABLE",
  );
});

test("narrationProgressEvent 只映射逐句配音阶段，不编造整体百分比", () => {
  const mapped = narrationProgressEvent({ projectId: "project-1", stage: "synthesize_narration", sentenceIndex: 2, total: 5, sentenceId: "s-2" });
  assert.deepEqual(mapped, { type: "narration-progress", projectId: "project-1", stage: "synthesize_narration", sentenceIndex: 2, total: 5, sentenceId: "s-2" });
  assert.equal(mapped !== undefined && "progress" in mapped, false, "逐句事件没有整体百分比可报，缺省而不是编造");
  assert.equal(narrationProgressEvent({ projectId: "project-1", progress: 0.5, stage: "export" }), undefined, "渲染阶段事件不属于配音进度，交由渲染监听处理");
});
