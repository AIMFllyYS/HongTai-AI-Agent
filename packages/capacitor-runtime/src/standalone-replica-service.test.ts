import assert from "node:assert/strict";
import test from "node:test";

import { TaskError, type ContentAnalysisRecord, type TaskDetailRecord } from "@hongtai/core";
import type { AiGenerateRequest, AiProvider, ProductionPlanResultV2 } from "@hongtai/ai";

import { StandaloneProductionService } from "./standalone-production-service.js";
import { StandaloneReplicaService } from "./standalone-replica-service.js";

const analysis: ContentAnalysisRecord = {
  taskId: "task-1",
  status: "succeeded",
  result: {
    schemaVersion: "content-analysis.v1",
    document: {
      schemaVersion: "content-analysis.v1",
      source: { taskId: "task-1", platform: "douyin", contentType: "video", sourceKind: "asr" },
      overview: { summary: "讲清门店服务流程", theme: "服务透明", targetAudiences: ["本地客户"], communicationGoal: "到店咨询" },
      hook: { type: "question", description: "先问顾客最担心什么", mechanism: "疑问抓注意", evidenceRefs: ["transcript-1"] },
      painPoints: [], emotionalDrivers: [], structure: [], coreClaims: [],
      style: { tones: ["平实"], pacing: "中速", languagePatterns: [], interactionMechanisms: [] },
      reusableTemplate: { formula: "疑问-过程", steps: [], variableSlots: [], doNotCopy: [] }, risks: [],
    },
  },
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
};

const taskDetail = {
  task: { id: "task-1", contentType: "video" },
  content: {},
  media: [],
  transcript: { source: "asr", text: "原视频讲了门店流程，只作为结构参考。", segments: [] },
  evidenceUnits: [
    { id: "transcript-1", source: "transcript", text: "很多顾客第一次来都会担心流程不清楚。", startSeconds: 0, endSeconds: 4 },
    { id: "transcript-2", source: "transcript", text: "我们会把每一步都做给你看。", startSeconds: 4, endSeconds: 9 },
  ],
} as unknown as TaskDetailRecord;

function blueprint(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    premise: "把服务流程一步步拍出来就能复刻这条内容。",
    suggestedTemplateId: "keyword_pop",
    shots: [
      {
        order: 1, role: "opening", subject: "operator",
        visualDescription: "店员正面出镜说明今天要看什么",
        material: { kind: "video", contentHint: "店员出镜开场", suggestedDurationSeconds: 6 },
        scriptDraft: "第一次来的朋友，最想知道流程怎么走。",
        evidenceRefs: ["transcript-1"],
      },
      {
        order: 2, role: "proof", subject: "environment",
        visualDescription: "从门口走进服务区的连续画面",
        material: { kind: "video", contentHint: "进店动线全景", suggestedDurationSeconds: 12 },
        scriptDraft: "从进门到落座，每一步都看得清楚。",
        evidenceRefs: ["transcript-2"],
      },
      {
        order: 3, role: "closing", subject: "operator",
        visualDescription: "店员收尾邀请到店",
        material: { kind: "image", contentHint: "收尾邀约画面", suggestedDurationSeconds: 12 },
        scriptDraft: "想看现场流程，随时来问。",
        evidenceRefs: ["transcript-2"],
      },
    ],
    emptyReason: null,
    ...overrides,
  });
}

function planFor(assetIds: readonly string[]): ProductionPlanResultV2 & { decorationSelections: readonly [] } {
  return {
    schemaVersion: "production-plan.v2",
    source: { analysisTaskId: "task-1" },
    title: "门店真实体验",
    settings: { width: 720, height: 1280, fps: 30, durationSeconds: 30 },
    audio: { voiceLocale: "zh-CN", speechRate: 1, backgroundMusicAssetId: null, backgroundMusicVolume: 0 },
    textOverlay: { primaryText: "真实门店", secondaryText: "看环境也看过程", preset: "classic_top" },
    shots: assetIds.map((assetId, index) => ({
      order: index + 1,
      assetId,
      durationSeconds: 30 / assetIds.length,
      narration: `这是第${index + 1}段真实记录的说明文字。`,
      caption: `第${index + 1}段`,
      fit: "cover" as const,
    })),
    decorationSelections: [],
  };
}

/**
 * The wizard spans two services, so the tests wire the real pair: a fake picker returns one file per
 * call and the provider answers whichever document the prompt asked for.
 */
function harness(options: {
  readonly plans?: readonly ProductionPlanResultV2[];
  readonly blueprintJson?: string;
  /** Makes reading the linked project fail, standing in for a transient private-file error. */
  readonly breakProjectRead?: boolean;
} = {}) {
  const taskFiles = new Map<string, string>();
  const projectFiles = new Map<string, string>();
  const projectIds = new Set<string>();
  const pickCalls: Array<{ readonly maxItems: number }> = [];
  const planningPrompts: string[] = [];
  let pick = 0;
  let planIndex = 0;

  const files = {
    writeText: async ({ taskId, relativePath, value }: { readonly taskId: string; readonly relativePath: string; readonly value: string; readonly replace: boolean }) => {
      taskFiles.set(`${taskId}/${relativePath}`, value);
    },
    readText: async ({ taskId, relativePath }: { readonly taskId: string; readonly relativePath: string }) => ({ value: taskFiles.get(`${taskId}/${relativePath}`) }),
    ensureProduction: async ({ projectId }: { readonly projectId: string }) => { projectIds.add(projectId); },
    writeProductionText: async ({ projectId, relativePath, value }: { readonly projectId: string; readonly relativePath: string; readonly value: string; readonly replace: boolean }) => {
      projectFiles.set(`${projectId}/${relativePath}`, value);
    },
    readProductionText: async ({ projectId, relativePath }: { readonly projectId: string; readonly relativePath: string }) => ({ value: projectFiles.get(`${projectId}/${relativePath}`) }),
    listProductionIds: async () => ({ projectIds: [...projectIds] }),
    deleteProductionFile: async ({ projectId, relativePath }: { readonly projectId: string; readonly relativePath: string }) => { projectFiles.delete(`${projectId}/${relativePath}`); },
    deleteProduction: async ({ projectId }: { readonly projectId: string }) => { projectIds.delete(projectId); },
  };

  const provider: AiProvider = {
    generate: async (request: AiGenerateRequest) => {
      const prompt = String(request.messages[0]?.content ?? "");
      if (request.jsonSchema?.name === "replica_blueprint_v1") {
        return { content: options.blueprintJson ?? blueprint(), reasoning: "" };
      }
      planningPrompts.push(prompt);
      const plans = options.plans ?? [planFor(["asset-b", "asset-c", "asset-a"])];
      const value = plans[Math.min(planIndex, plans.length - 1)]!;
      planIndex += 1;
      return { content: JSON.stringify(value), reasoning: "" };
    },
    transcribe: async () => "",
  };

  const native = {
    pickAssets: async (pickOptions: { readonly projectId: string; readonly maxItems: number; readonly selection?: "visual" | "avatar" }) => {
      pickCalls.push({ maxItems: pickOptions.maxItems });
      const id = ["asset-a", "asset-b", "asset-c", "asset-d"][pick] ?? "asset-x";
      pick += 1;
      return { assets: [{ id, uri: `file:///private/productions/project-1/inputs/${id}.mp4`, kind: "video" as const, mimeType: "video/mp4", displayName: `${id}.mp4`, sizeBytes: 200, durationSeconds: 12 }] };
    },
    render: async () => ({ uri: "file:///private/productions/project-1/output.mp4", mimeType: "video/mp4" as const, sizeBytes: 1_024, durationSeconds: 30 }),
    consumeAssetOperation: async () => ({ status: "none" as const }),
    probeTts: async () => undefined,
    synthesizeNarration: async () => ({ sentences: [] }),
  };

  const analysisPort = {
    get: async () => analysis,
    run: async () => analysis,
    importVideo: async () => analysis,
    consumeVideoRecovery: async () => ({ status: "none" as const }),
    subscribe: () => () => undefined,
  };
  const tasks = { getDetail: async () => taskDetail };
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 7, 8, 0, 0, (tick += 1)));

  const production: StandaloneProductionService = new StandaloneProductionService({
    files,
    native,
    analysis: analysisPort,
    blueprints: { get: async (taskId: string) => replica.get(taskId) },
    tasks,
    getProvider: async () => provider,
    getNarrationMode: async () => "system",
    toDisplayUri: (uri: string) => uri,
    createProjectId: () => `project-${projectIds.size + 1}`,
    now,
  });
  let readsBroken = false;
  const productionPort = {
    create: production.create.bind(production),
    delete: production.delete.bind(production),
    get: async (projectId: string) => {
      if (readsBroken) throw new Error("EIO: private file unavailable");
      return production.get(projectId);
    },
  };
  const replica: StandaloneReplicaService = new StandaloneReplicaService({
    files, analysis: analysisPort, tasks, production: productionPort, getProvider: async () => provider, now,
  });
  if (options.breakProjectRead) readsBroken = true;

  return {
    production,
    replica,
    taskFiles,
    projectFiles,
    pickCalls,
    planningPrompts,
    breakProjectRead: () => { readsBroken = true; },
  };
}

async function boundProject(context: ReturnType<typeof harness>, orders: readonly number[]) {
  await context.replica.run("task-1");
  const project = await context.replica.startProject("task-1");
  for (const order of orders) {
    await context.production.importAssets(project.projectId, { requirementOrder: order });
  }
  return project;
}

test("蓝图落盘后复用同一个制作项目，目标时长就是清单自己的合计", async () => {
  const context = harness();
  const record = await context.replica.run("task-1");

  assert.equal(record.status, "succeeded");
  assert.equal(record.blueprint?.schemaVersion, "replica-blueprint.v1");
  assert.equal(await context.replica.get("task-1").then((value) => value?.status), "succeeded", "清单必须落盘，重开向导不该再花一次模型调用");

  const project = await context.replica.startProject("task-1");
  assert.equal(project.targetDurationSeconds, 30, "6+12+12：清单合计就是目标时长，不必塞进四档预设");
  assert.equal(project.status, "draft");
  assert.equal(project.brief, "把服务流程一步步拍出来就能复刻这条内容。");

  const again = await context.replica.startProject("task-1");
  assert.equal(again.projectId, project.projectId, "重开向导要回到正在拍的项目，而不是又建一个");
});

test("逐项导入只收一个素材并记住它属于哪一项", async () => {
  const context = harness();
  // 故意乱序绑定：清单顺序必须来自清单本身，而不是用户先拍了哪个。
  const project = await boundProject(context, [3, 1, 2]);
  const current = await context.production.get(project.projectId);

  assert.deepEqual(context.pickCalls.map((call) => call.maxItems), [1, 1, 1], "逐项导入不能打开多选");
  assert.deepEqual(
    current?.assets.map((asset) => [asset.id, asset.requirementOrder]),
    [["asset-a", 3], ["asset-b", 1], ["asset-c", 2]],
  );
  assert.equal(current?.status, "draft");
});

test("同一项不能被两个素材占用，先移除才能换", async () => {
  const context = harness();
  const project = await boundProject(context, [1]);
  await assert.rejects(() => context.production.importAssets(project.projectId, { requirementOrder: 1 }), (error: unknown) => {
    assert.ok(error instanceof TaskError);
    assert.match(error.message, /第 1 项已经有素材/u);
    assert.equal(error.action, "select_media");
    return true;
  });

  const bound = await context.production.get(project.projectId);
  await context.production.removeAsset(project.projectId, bound!.assets[0]!.id);
  const replaced = await context.production.importAssets(project.projectId, { requirementOrder: 1 });
  assert.deepEqual(replaced.assets.map((asset) => asset.requirementOrder), [1], "移除后同一项可以重新绑定");
});

test("成片镜头必须按清单顺序使用绑定素材，而不是用户导入的顺序", async () => {
  const context = harness();
  // 绑定顺序 3、1、2：asset-a 属于第3项，asset-b 属于第1项，asset-c 属于第2项。
  const project = await boundProject(context, [3, 1, 2]);
  const ready = await context.production.generatePlan(project.projectId);

  const document = ready.plan?.document as unknown as { readonly shots: readonly { readonly assetId: string }[] };
  assert.deepEqual(document.shots.map((shot) => shot.assetId), ["asset-b", "asset-c", "asset-a"]);
  assert.match(context.planningPrompts[0] ?? "", /镜头素材对应表/u, "顺序要求必须先告诉模型，不能只靠事后拒绝");
  assert.match(context.planningPrompts[0] ?? "", /进店动线全景/u, "每镜的拍摄意图要进提示词，否则口播和画面对不上");
});

test("模型按导入顺序排镜头时被拒绝，修一次仍不对就失败", async () => {
  // 两轮都返回“按导入顺序”的计划：第1项拍的是 asset-b，计划却把 asset-a 放在第一镜。
  const wrong = planFor(["asset-a", "asset-b", "asset-c"]);
  const context = harness({ plans: [wrong, wrong] });
  const project = await boundProject(context, [3, 1, 2]);

  await assert.rejects(() => context.production.generatePlan(project.projectId), (error: unknown) => {
    assert.ok(error instanceof TaskError);
    assert.equal(error.code, "AI_FORMAT_REPAIR_FAILED");
    return true;
  });
  const failed = await context.production.get(project.projectId);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.plan, undefined, "顺序对不上时不能落一份把素材放错位置的计划");
});

test("镜头数必须等于已绑定的项数：跳过的项不会被悄悄补回来", async () => {
  const context = harness({ plans: [planFor(["asset-b", "asset-c", "asset-a", "asset-d"])] });
  const project = await boundProject(context, [3, 1, 2]);

  await assert.rejects(() => context.production.generatePlan(project.projectId), (error: unknown) => {
    assert.ok(error instanceof TaskError);
    assert.equal(error.code, "AI_FORMAT_REPAIR_FAILED");
    return true;
  });
});

test("清单已绑定拍好的素材时拒绝重新生成，避免已拍素材被换成别的清单项", async () => {
  const context = harness();
  await boundProject(context, [1]);

  await assert.rejects(() => context.replica.run("task-1"), (error: unknown) => {
    assert.ok(error instanceof TaskError);
    assert.match(error.message, /先删掉正在使用它的制作项目/u);
    assert.equal(error.action, "none", "向导按 none 展示 userMessage；改成 retry 会重新走共享套话");
    return true;
  });
  assert.equal(await context.replica.get("task-1").then((value) => value?.status), "succeeded", "被拒绝的重生成不能把已有清单写坏");
});

test("清单读不到时不生成计划，而不是让模型自己决定顺序", async () => {
  const context = harness();
  const project = await boundProject(context, [1, 2, 3]);
  context.taskFiles.delete("task-1/replica-blueprint.json");

  await assert.rejects(() => context.production.generatePlan(project.projectId), (error: unknown) => {
    assert.ok(error instanceof TaskError);
    assert.match(error.message, /清单已经读不到了/u);
    return true;
  });
});

test("空清单和镜头太少的清单都不能开项目，并说明原因", async () => {
  const empty = harness({ blueprintJson: blueprint({ shots: [], emptyReason: "转写只有寒暄，说不出可拍的画面。" }) });
  await empty.replica.run("task-1");
  await assert.rejects(() => empty.replica.startProject("task-1"), (error: unknown) => {
    assert.ok(error instanceof TaskError);
    assert.match(error.message, /转写只有寒暄/u);
    return true;
  });

  const twoShots = (JSON.parse(blueprint()) as { readonly shots: readonly Record<string, unknown>[] }).shots
    .slice(0, 2)
    .map((shot, index) => ({ ...shot, material: { kind: "video", contentHint: `第 ${index + 1} 段`, suggestedDurationSeconds: 10 } }));
  const short = harness({ blueprintJson: blueprint({ shots: twoShots }) });
  await short.replica.run("task-1");
  await assert.rejects(() => short.replica.startProject("task-1"), (error: unknown) => {
    assert.ok(error instanceof TaskError);
    assert.match(error.message, /至少需要 3 个镜头/u);
    assert.equal(error.action, "none", "向导按 none 展示 userMessage；改成 retry 会重新走共享套话");
    return true;
  });
});

test("读不到已绑定的项目时拒绝重新生成清单，而不是当成项目已删除", async () => {
  const context = harness();
  await boundProject(context, [1]);
  context.breakProjectRead();

  await assert.rejects(() => context.replica.run("task-1"), (error: unknown) => {
    assert.ok(error instanceof TaskError);
    assert.equal(error.code, "STORAGE_READ_FAILED");
    assert.equal(error.action, "retry");
    return true;
  });
  const kept = await context.replica.get("task-1");
  assert.equal(kept?.status, "succeeded", "读盘失败不能变成覆盖清单的许可");
  assert.ok(kept?.projectId, "清单和项目的链接要留着");
});

test("外部选择器留下的待绑定标记不会挂到制作页随手加的素材上", async () => {
  const context = harness();
  const project = await boundProject(context, [1]);

  // 选择器带走 WebView 后取消或失败，标记留在盘上：进程内的清理没有机会跑。
  const key = `${project.projectId}/project.json`;
  const stored = JSON.parse(context.projectFiles.get(key)!) as Record<string, unknown>;
  context.projectFiles.set(key, JSON.stringify({ ...stored, pendingRequirementOrder: 3 }));

  const after = await context.production.importAssets(project.projectId);
  const added = after.assets.find((asset) => asset.id !== "asset-a");
  assert.equal(added?.requirementOrder, undefined, "这次导入没说是第几项，就不能算成第 3 项的素材");
  assert.deepEqual(
    after.assets.filter((asset) => asset.requirementOrder !== undefined).map((asset) => asset.requirementOrder),
    [1],
    "原有绑定不受影响",
  );
  assert.equal(
    (JSON.parse(context.projectFiles.get(key)!) as Record<string, unknown>).pendingRequirementOrder,
    undefined,
    "过期标记要被清掉，不能等下一次导入再中招",
  );
});

test("还没有清单就开项目会被拒绝，不会先建一个空项目", async () => {
  const context = harness();
  await assert.rejects(() => context.replica.startProject("task-1"), (error: unknown) => {
    assert.ok(error instanceof TaskError);
    assert.match(error.message, /请先生成/u);
    return true;
  });
  assert.equal(await context.production.list().then((list) => list.length), 0);
});
