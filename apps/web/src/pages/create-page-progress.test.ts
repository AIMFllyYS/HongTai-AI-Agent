import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { productionRenderStageCopy } from "./CreatePage";
import {
  MAX_PRODUCTION_DURATION_SECONDS,
  MAX_SHOT_DURATION_SECONDS,
  MIN_PRODUCTION_DURATION_SECONDS,
} from "@hongtai/core";
import {
  composeViolationItems,
  PRODUCTION_PIPELINE_STAGE_LABELS,
  productionPreviewSource,
  resolveNarrationDurationAdvisory,
  resolvePipelinePrimaryAction,
  resolveProductionPipelineStage,
  resolveProductionRetryKind,
  resolveProductionRetryOperation,
} from "../features/production/production-workbench-model";

const webRoot = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");
const page = `${read("pages/CreatePage.tsx")}\n${read("features/production/production-workbench-page.tsx")}`;
const forms = read("features/production/production-setup-forms.tsx");
const createSurface = `${page}\n${forms}`;

test("制作进度文案只按稳定 stage 白名单映射，未知 stage 不猜业务", () => {
  assert.equal(productionRenderStageCopy("validate_avatar_audio"), "正在校验口播切片原声");
  assert.equal(productionRenderStageCopy("synthesize_narration"), "正在生成旁白");
  assert.equal(productionRenderStageCopy("compile_shots"), "正在编排镜头");
  assert.equal(productionRenderStageCopy("export"), "正在本地合成");
  assert.equal(productionRenderStageCopy("saved"), "成片已保存");
  assert.equal(productionRenderStageCopy(""), "正在本地合成");
  assert.equal(productionRenderStageCopy("unknown_future_stage"), "正在本地合成");
  assert.equal(productionRenderStageCopy("正在生成旁白"), "正在本地合成");
});

test("五阶段会话模型：阶段推导按项目状态映射，主按钮文案不得自创", () => {
  assert.equal(resolveProductionPipelineStage({}), "requirement");
  assert.equal(resolveProductionPipelineStage({ scriptGenerating: true }), "script");
  assert.equal(resolveProductionPipelineStage({ project: { status: "draft" } }), "script");
  assert.equal(resolveProductionPipelineStage({ project: { status: "draft" }, legacyPipeline: true }), "output");
  assert.equal(resolveProductionPipelineStage({ project: { status: "draft", storyboard: {} } }), "script");
  assert.equal(resolveProductionPipelineStage({ project: { status: "draft", storyboard: {}, narration: { ready: 0, total: 3 } } }), "script");
  assert.equal(resolveProductionPipelineStage({ project: { status: "draft", storyboard: {}, narration: { ready: 1, total: 3 } } }), "narration");
  assert.equal(resolveProductionPipelineStage({ project: { status: "draft", storyboard: {}, narration: { ready: 3, total: 3 } } }), "compose");
  assert.equal(resolveProductionPipelineStage({ project: { status: "rendering", storyboard: {}, narration: { ready: 3, total: 3 } } }), "output");
  assert.equal(resolveProductionPipelineStage({ project: { status: "succeeded", storyboard: {}, narration: { ready: 3, total: 3 } } }), "output");

  assert.equal(resolvePipelinePrimaryAction("requirement").label, "创建制作项目");
  assert.equal(resolvePipelinePrimaryAction("script", { storyboardReady: false }).label, "AI 生成分镜脚本");
  assert.equal(resolvePipelinePrimaryAction("script", { storyboardReady: true }).label, "确认文稿并生成配音");
  assert.equal(resolvePipelinePrimaryAction("narration").label, "补齐配音");
  assert.equal(resolvePipelinePrimaryAction("compose", { planComposed: false }).label, "开始合成");
  assert.equal(resolvePipelinePrimaryAction("compose", { planComposed: true }).label, "重新合成");
  assert.equal(resolvePipelinePrimaryAction("output", { rendering: true }).label, "正在本地合成");
  assert.equal(resolvePipelinePrimaryAction("output", { rendering: true }).disabled, true);
  assert.equal(resolvePipelinePrimaryAction("output", { hasOutput: true }).label, "再做一条");
  assert.equal(resolvePipelinePrimaryAction("output").label, "开始本地合成");
  assert.equal(resolvePipelinePrimaryAction("compose", { failed: true }).label, "重试");
  assert.equal(resolvePipelinePrimaryAction("script", { busy: true }).disabled, true);
  assert.equal(resolvePipelinePrimaryAction("requirement").disabled, false);

  assert.equal(PRODUCTION_PIPELINE_STAGE_LABELS.requirement.title, "需求");
  assert.equal(PRODUCTION_PIPELINE_STAGE_LABELS.output.title, "成片");
});

test("配音实测软边界只提示不阻塞，文案含实测秒数且不编造", () => {
  const ok = resolveNarrationDurationAdvisory(30_000, [10_000, 20_000]);
  assert.equal(ok.items.length, 0);
  assert.equal(ok.requiresAcknowledgement, false);

  const short = resolveNarrationDurationAdvisory(8_000, [4_000, 4_000]);
  assert.equal(short.items.length, 1);
  assert.equal(short.items[0]?.kind, "total-too-short");
  assert.match(short.items[0]?.message ?? "", /8 秒/);
  assert.match(short.items[0]?.message ?? "", new RegExp(`不足 ${MIN_PRODUCTION_DURATION_SECONDS} 秒`));
  assert.equal(short.requiresAcknowledgement, true);

  const tooLong = resolveNarrationDurationAdvisory((MAX_PRODUCTION_DURATION_SECONDS + 10) * 1_000, [10_000]);
  assert.equal(tooLong.items.length, 1);
  assert.equal(tooLong.items[0]?.kind, "total-too-long");

  const sentenceLong = resolveNarrationDurationAdvisory(30_000, [(MAX_SHOT_DURATION_SECONDS + 1) * 1_000]);
  assert.equal(sentenceLong.items.length, 1);
  assert.equal(sentenceLong.items[0]?.kind, "sentence-too-long");
  assert.equal(sentenceLong.items[0]?.sentenceIndex, 1);
});

test("合成软违规按稳定 reason 投影为界面条目，不解析供应商文案", () => {
  const items = composeViolationItems([
    { reason: "shot-too-long", kind: "soft", shotIndex: 2, durationMs: 21_000 },
    { reason: "total-too-short", kind: "soft", totalDurationMs: 9_000 },
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.reason, "shot-too-long");
  assert.match(items[0]?.message ?? "", /第 2 句/);
  assert.equal(items[1]?.reason, "total-too-short");
  assert.match(items[1]?.message ?? "", /9 秒/);
});

test("失败主按钮只按 TaskIssue.action 分支，重试操作不解析中文", () => {
  assert.equal(resolveProductionRetryKind("select_media"), "import");
  assert.equal(resolveProductionRetryKind("configure_ai"), "configure-ai");
  assert.equal(resolveProductionRetryKind("edit_input"), "edit-input");
  assert.equal(resolveProductionRetryKind("retry"), "retry-operation");
  assert.equal(resolveProductionRetryKind("wait_and_retry"), "retry-operation");
  assert.equal(resolveProductionRetryKind("none"), "retry-operation");
  assert.equal(resolveProductionRetryKind(undefined), "retry-operation");
  assert.equal(resolveProductionRetryOperation({ assets: [], plan: {} }), "render");
  assert.equal(resolveProductionRetryOperation({ assets: [{}] }), "generate-plan");
  assert.equal(resolveProductionRetryOperation({ assets: [] }), "import");
});

test("未出片预览用素材首帧，出片只播 output.uri", () => {
  assert.deepEqual(productionPreviewSource({ assets: [] }), { kind: "empty" });
  assert.deepEqual(
    productionPreviewSource({ assets: [{ kind: "image", uri: "asset://poster" }] }),
    { kind: "image", uri: "asset://poster" },
  );
  assert.deepEqual(
    productionPreviewSource({
      assets: [{ kind: "video", uri: "asset://clip" }],
      output: { uri: "asset://output" },
    }),
    { kind: "output", uri: "asset://output" },
  );
});

test("制作页用 contextualAction 单主按钮、五阶段时间线与 9:16 预览，完成态没有发布入口", () => {
  const panel = read("features/production/production-pipeline-panel.tsx");
  const css = read("styles/pages/production-runtime.css");
  const model = read("features/production/production-workbench-model.ts");
  const surface = `${page}\n${panel}\n${css}\n${model}`;

  assert.match(page, /contextualAction=\{/);
  assert.doesNotMatch(page, /contextual-action-hint/);
  assert.doesNotMatch(page, /contextual-action-stack/);
  assert.match(read("styles/components.css"), /\.contextual-action \.button:not\(:disabled\)\s*\{[^}]*pointer-events:\s*auto/s);
  assert.match(read("styles/components.css"), /\.contextual-action\s*\{[^}]*pointer-events:\s*none/s);
  assert.doesNotMatch(read("styles/components.css"), /\.contextual-action > \*\s*\{[^}]*pointer-events:\s*auto/s);
  assert.doesNotMatch(read("styles/components.css"), /\.contextual-action-hint/);
  assert.match(page, /resolvePipelinePrimaryAction/);
  assert.match(page, /resolveProductionPipelineStage/);
  assert.match(page, /setComposingNew\(true\)/);
  assert.match(page, /runtime\.production\.create/);
  assert.match(page, /runtime\.production\.importAssets/);
  assert.match(page, /scriptProductionService\(runtime\.production\)/);
  assert.match(page, /service\.generateScript/);
  assert.match(page, /service\.synthesizeNarration/);
  assert.match(page, /service\.updateStoryboard/);
  assert.match(page, /service\.composeMeasuredPlan/);
  assert.match(page, /runtime\.production\.render/);
  assert.match(createSurface, /参考哪条拆解/);
  assert.match(createSurface, /这次想讲什么/);
  assert.doesNotMatch(page, /新建制作项目/);
  assert.doesNotMatch(page, />01</);
  assert.doesNotMatch(page, /发布/);

  assert.match(panel, /production-pipeline-timeline/);
  assert.match(panel, /PRODUCTION_PIPELINE_STAGE_LABELS/);
  assert.match(panel, /project\.issue/);
  assert.match(panel, /production-render-progress/);
  assert.match(panel, /确认删除成片/);
  assert.match(panel, /确认删除项目/);
  assert.match(panel, /重新生成分镜/);
  assert.match(panel, /onUpdateStoryboard/);
  assert.match(panel, /onSynthesizeSentence/);
  assert.doesNotMatch(panel, /本地合成视频/);
  assert.doesNotMatch(panel, /production-actions/);
  assert.doesNotMatch(panel, /发布/);

  assert.match(css, /aspect-ratio:\s*9\s*\/\s*16/);
  assert.match(css, /max-width:\s*17\.5rem/);
  assert.match(css, /padding-bottom:\s*calc\(/);
  assert.match(css, /\.production-pipeline-timeline/);
  assert.match(css, /\.production-pipeline-sentence/);
  assert.match(css, /\.production-pipeline-narration-list/);
  assert.doesNotMatch(surface, /时间轴|逐帧|转场编辑/);
});

test("制作页回到前台会消费素材恢复，且成功或失败才清 busy", () => {
  const page = `${read("pages/CreatePage.tsx")}\n${read("features/production/production-workbench-page.tsx")}`;
  assert.match(page, /useAppResume\(\(\) => \{\s*void load\(\);\s*void applyAssetRecovery\(\);/u);
  assert.match(page, /runtime\.production\.consumeAssetRecovery\(\)/u);
  assert.match(page, /runtime\.production\.list\(\)/u, "list 会把 SPA 内卡住的 planning/rendering 收成可重试失败");
  const apply = page.slice(page.indexOf("const applyAssetRecovery"), page.indexOf("useAppResume(() =>"));
  assert.match(apply, /recovered\.status === "succeeded"/u);
  assert.match(apply, /recovered\.status === "failed"/u);
  assert.doesNotMatch(apply, /finally \{\s*setBusy\(false\)/u);
});

test("带 sourceId 进入制作页强制新建并选中该来源，匹配失败不换一条", async () => {
  const { resolveCreateWorkbenchEntry } = await import("./task-page-model") as {
    resolveCreateWorkbenchEntry?: (input: {
      readonly requestedSourceId: string;
      readonly availableSourceIds: readonly string[];
      readonly currentSourceId?: string;
      readonly composingNew?: boolean;
    }) => {
      readonly composingNew: boolean;
      readonly sourceId: string;
      readonly sourceMatchFailed: boolean;
    };
  };
  assert.equal(typeof resolveCreateWorkbenchEntry, "function");

  assert.deepEqual(resolveCreateWorkbenchEntry?.({
    requestedSourceId: "task-degraded",
    availableSourceIds: ["task-degraded", "task-other"],
    currentSourceId: "",
    composingNew: false,
  }), { composingNew: true, sourceId: "task-degraded", sourceMatchFailed: false });

  assert.deepEqual(resolveCreateWorkbenchEntry?.({
    requestedSourceId: "task-missing",
    availableSourceIds: ["task-other"],
    currentSourceId: "",
    composingNew: false,
  }), { composingNew: true, sourceId: "", sourceMatchFailed: true });

  assert.deepEqual(resolveCreateWorkbenchEntry?.({
    requestedSourceId: "",
    availableSourceIds: ["task-other"],
    currentSourceId: "",
    composingNew: false,
  }), { composingNew: false, sourceId: "task-other", sourceMatchFailed: false });

  assert.deepEqual(resolveCreateWorkbenchEntry?.({
    requestedSourceId: "",
    availableSourceIds: ["task-other"],
    currentSourceId: "task-kept",
    composingNew: true,
  }), { composingNew: true, sourceId: "task-other", sourceMatchFailed: false });

  assert.deepEqual(resolveCreateWorkbenchEntry?.({
    requestedSourceId: "",
    availableSourceIds: ["task-kept", "task-other"],
    currentSourceId: "task-kept",
    composingNew: true,
  }), { composingNew: true, sourceId: "task-kept", sourceMatchFailed: false });

  const page = `${read("pages/CreatePage.tsx")}\n${read("features/production/production-workbench-page.tsx")}`;
  const model = read("pages/task-page-model.ts");
  assert.match(page, /resolveCreateWorkbenchEntry/);
  assert.match(page, /status:\s*"degraded"/);
  assert.match(page, /sourceMatchFailed/);
  assert.match(page, /CONTENT_NOT_FOUND/);
  assert.match(model, /status === "degraded"|status === 'degraded'/);
  const again = page.slice(page.indexOf("if (stage === \"output\") {"), page.indexOf("const issueActions"));
  assert.match(again, /startNewProduction\(\)/);
  assert.doesNotMatch(again, /deleteProject|production\.delete/);
});

test("带 sourceId 首次进入会新建，同一地址再次 load 不再强制新建", async () => {
  const model = await import("./task-page-model") as {
    peekCreateSourceIdFromSearch?: () => string;
    consumeCreateSourceIdFromSearch?: () => string;
    resolveCreateWorkbenchEntry?: (input: {
      readonly requestedSourceId: string;
      readonly availableSourceIds: readonly string[];
      readonly currentSourceId?: string;
      readonly composingNew?: boolean;
    }) => {
      readonly composingNew: boolean;
      readonly sourceId: string;
      readonly sourceMatchFailed: boolean;
    };
    sourceIdFromSearch?: (search: string) => string;
  };
  assert.equal(typeof model.peekCreateSourceIdFromSearch, "function");
  assert.equal(typeof model.consumeCreateSourceIdFromSearch, "function");
  assert.equal(typeof model.resolveCreateWorkbenchEntry, "function");

  const location = { pathname: "/create", search: "?sourceId=task-1&keep=yes", hash: "" };
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window: unknown }).window = {
    location,
    history: {
      state: {},
      replaceState(_data: unknown, _title: string, url: string) {
        const parsed = new URL(url, `https://hongtai.local${location.pathname}${location.search}`);
        location.pathname = parsed.pathname;
        location.search = parsed.search;
        location.hash = parsed.hash;
      },
    },
  };

  try {
    const peeked = model.peekCreateSourceIdFromSearch?.() ?? "";
    assert.equal(peeked, "task-1");
    assert.equal(location.search, "?sourceId=task-1&keep=yes");
    assert.equal(model.sourceIdFromSearch?.(location.search), "task-1");
    assert.deepEqual(model.resolveCreateWorkbenchEntry?.({
      requestedSourceId: peeked,
      availableSourceIds: ["task-1", "task-other"],
      currentSourceId: "",
      composingNew: false,
    }), { composingNew: true, sourceId: "task-1", sourceMatchFailed: false });

    const firstRequested = model.consumeCreateSourceIdFromSearch?.() ?? "";
    assert.equal(firstRequested, "task-1");
    assert.equal(location.pathname, "/create");
    assert.doesNotMatch(location.pathname, /\?|sourceId=/);
    assert.equal(location.search, "?keep=yes");
    assert.equal(model.sourceIdFromSearch?.(location.search), "");

    const resumePeeked = model.peekCreateSourceIdFromSearch?.() ?? "";
    assert.equal(resumePeeked, "");
    assert.deepEqual(model.resolveCreateWorkbenchEntry?.({
      requestedSourceId: resumePeeked,
      availableSourceIds: ["task-1", "task-other"],
      currentSourceId: "task-1",
      composingNew: false,
    }), { composingNew: false, sourceId: "task-1", sourceMatchFailed: false });

    assert.deepEqual(model.resolveCreateWorkbenchEntry?.({
      requestedSourceId: "",
      availableSourceIds: ["task-other"],
      currentSourceId: "",
      composingNew: true,
    }), { composingNew: true, sourceId: "", sourceMatchFailed: false });
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window: unknown }).window = previousWindow;
  }

  const page = `${read("pages/CreatePage.tsx")}\n${read("features/production/production-workbench-page.tsx")}`;
  assert.match(page, /peekCreateSourceIdFromSearch/);
  assert.match(page, /consumeCreateSourceIdFromSearch/);
  assert.doesNotMatch(page, /sourceIdFromSearch\(window\.location\.search\)/);
  const load = page.slice(page.indexOf("const load = useCallback"), page.indexOf("}, [runtime, searchEpoch]);"));
  assert.match(load, /peekCreateSourceIdFromSearch\(\)/);
  assert.ok(load.indexOf("peekCreateSourceIdFromSearch") < load.indexOf("runtime.tasks.list"));
  assert.ok(load.indexOf("runtime.tasks.list") < load.indexOf("consumeCreateSourceIdFromSearch"));
  assert.ok(load.indexOf("consumeCreateSourceIdFromSearch") < load.indexOf("} catch (error)"));
});

test("制作页首次列表失败时保留 sourceId，成功或明确未找到后再消费", async () => {
  const model = await import("./task-page-model") as {
    peekCreateSourceIdFromSearch?: () => string;
    consumeCreateSourceIdFromSearch?: () => string;
    sourceIdFromSearch?: (search: string) => string;
  };
  const location = { pathname: "/create", search: "?sourceId=task-kept", hash: "" };
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window: unknown }).window = {
    location,
    history: {
      state: {},
      replaceState(_data: unknown, _title: string, url: string) {
        const parsed = new URL(url, `https://hongtai.local${location.pathname}${location.search}`);
        location.pathname = parsed.pathname;
        location.search = parsed.search;
        location.hash = parsed.hash;
      },
    },
  };
  try {
    assert.equal(model.peekCreateSourceIdFromSearch?.(), "task-kept");
    assert.equal(location.search, "?sourceId=task-kept");
    assert.equal(model.sourceIdFromSearch?.(location.search), "task-kept");
    assert.equal(model.peekCreateSourceIdFromSearch?.(), "task-kept");
    assert.equal(model.consumeCreateSourceIdFromSearch?.(), "task-kept");
    assert.equal(location.search, "");
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previousWindow;
  }
});

test("五阶段推导：脚本生成中归分镜文稿，无 storyboard 的 v3 存量归成片，配音按句级就绪推进", () => {
  assert.equal(resolveProductionPipelineStage({}), "requirement");
  assert.equal(resolveProductionPipelineStage({ scriptGenerating: true }), "script");
  assert.equal(resolveProductionPipelineStage({
    scriptGenerating: true,
    project: { status: "planning", narration: { ready: 0, total: 0 } },
  }), "script", "脚本尚未落盘时以页面在飞标志为准");

  // v3 存量项目（无分镜脚本且带旧版计划，页面据此传 legacyPipeline）：直接呈现成片/渲染区。
  assert.equal(resolveProductionPipelineStage({ project: { status: "draft" }, legacyPipeline: true }), "output");
  assert.equal(resolveProductionPipelineStage({ project: { status: "planning" }, legacyPipeline: true }), "output");
  assert.equal(resolveProductionPipelineStage({ project: { status: "ready" }, legacyPipeline: true }), "output");
  assert.equal(resolveProductionPipelineStage({ project: { status: "failed" }, legacyPipeline: true }), "output");
  assert.equal(resolveProductionPipelineStage({ project: { status: "rendering" }, legacyPipeline: true }), "output");
  assert.equal(resolveProductionPipelineStage({ project: { status: "succeeded" }, legacyPipeline: true }), "output");

  // v4：渲染中/已成片优先归「成片」，即使脚本与配音字段都在。
  assert.equal(resolveProductionPipelineStage({
    project: { status: "rendering", storyboard: {}, narration: { ready: 3, total: 3 } },
  }), "output");
  assert.equal(resolveProductionPipelineStage({
    project: { status: "succeeded", storyboard: {}, narration: { ready: 3, total: 3 } },
  }), "output");

  // v4：脚本已生成但一句配音都没有 → 分镜文稿（等确认）。
  assert.equal(resolveProductionPipelineStage({
    project: { status: "draft", storyboard: {}, narration: { ready: 0, total: 3 } },
  }), "script");
  assert.equal(resolveProductionPipelineStage({
    project: { status: "draft", storyboard: {} },
  }), "script", "配音字段缺省按零句就绪处理");
  // 部分句子就绪 → 配音。
  assert.equal(resolveProductionPipelineStage({
    project: { status: "draft", storyboard: {}, narration: { ready: 2, total: 3 } },
  }), "narration");
  // 全部就绪 → 合成（是否组装过 v4 计划只影响按钮文案，不影响阶段）。
  assert.equal(resolveProductionPipelineStage({
    project: { status: "draft", storyboard: {}, narration: { ready: 3, total: 3 } },
  }), "compose");
  assert.equal(resolveProductionPipelineStage({
    project: { status: "ready", storyboard: {}, narration: { ready: 3, total: 3 } },
  }), "compose");
});

test("五阶段主按钮：script 视脚本就绪、compose 视计划组装，output 沿用现有渲染/输出语义", () => {
  for (const stage of ["requirement", "script", "narration", "compose", "output"] as const) {
    assert.ok(PRODUCTION_PIPELINE_STAGE_LABELS[stage].title.trim().length > 0);
    assert.ok(PRODUCTION_PIPELINE_STAGE_LABELS[stage].description.trim().length > 0);
  }
  assert.equal(PRODUCTION_PIPELINE_STAGE_LABELS.narration.description, "逐句合成配音，时长以实测为准。");

  assert.equal(resolvePipelinePrimaryAction("requirement").label, "创建制作项目");
  assert.equal(resolvePipelinePrimaryAction("requirement", { busy: true }).disabled, true);
  assert.equal(resolvePipelinePrimaryAction("script", { storyboardReady: false }).label, "AI 生成分镜脚本");
  assert.equal(resolvePipelinePrimaryAction("script", { storyboardReady: true }).label, "确认文稿并生成配音");
  assert.equal(resolvePipelinePrimaryAction("script", { storyboardReady: true, busy: true }).disabled, true);
  assert.equal(resolvePipelinePrimaryAction("narration").label, "补齐配音");
  assert.equal(resolvePipelinePrimaryAction("compose", { planComposed: false }).label, "开始合成");
  assert.equal(resolvePipelinePrimaryAction("compose", { planComposed: true }).label, "重新合成");
  assert.deepEqual(resolvePipelinePrimaryAction("output", { rendering: true }), { label: "正在本地合成", disabled: true });
  assert.equal(resolvePipelinePrimaryAction("output", { hasOutput: true }).label, "再做一条");
  assert.equal(resolvePipelinePrimaryAction("output", {}).label, "开始本地合成");

  // 失败态：模型层只给通用「重试」；具体入口由页面按稳定 TaskIssue.code/action 分支。
  assert.deepEqual(resolvePipelinePrimaryAction("compose", { planComposed: true, failed: true }), { label: "重试", disabled: false });
  assert.deepEqual(resolvePipelinePrimaryAction("script", { storyboardReady: false, failed: true, busy: true }), { label: "重试", disabled: true });
});

test("配音软边界提示复用 core 常量：总时长过短/过长与单句超长都要确认放行", () => {
  const model = read("features/production/production-workbench-model.ts");
  assert.match(model, /MIN_PRODUCTION_DURATION_SECONDS/u);
  assert.match(model, /MAX_PRODUCTION_DURATION_SECONDS/u);
  assert.match(model, /MAX_SHOT_DURATION_SECONDS/u);

  // 全部在界内：无提示、无需确认。
  assert.deepEqual(resolveNarrationDurationAdvisory(30_000, [8_000, 12_000, 10_000]), { items: [], requiresAcknowledgement: false });

  // 总时长不足下限。
  const tooShort = resolveNarrationDurationAdvisory(12_000, [4_000, 8_000]);
  assert.equal(tooShort.requiresAcknowledgement, true);
  assert.equal(tooShort.items.length, 1);
  assert.equal(tooShort.items[0]?.kind, "total-too-short");
  assert.equal(tooShort.items[0]?.message, `实测配音总时长约 12 秒，不足 ${MIN_PRODUCTION_DURATION_SECONDS} 秒，成片会偏短。`);

  // 总时长超上限（句子本身都在单句界内）。
  const tooLong = resolveNarrationDurationAdvisory(65_000, [20_000, 15_000, 15_000, 15_000]);
  assert.equal(tooLong.items.length, 1);
  assert.equal(tooLong.items[0]?.kind, "total-too-long");
  assert.equal(tooLong.items[0]?.message, `实测配音总时长约 65 秒，超过 ${MAX_PRODUCTION_DURATION_SECONDS} 秒，建议精简文稿。`);

  // 单句超过上限（1-based 句序定位）。
  const sentence = resolveNarrationDurationAdvisory(45_000, [10_000, 24_500, 10_500]);
  assert.equal(sentence.items.length, 1);
  assert.equal(sentence.items[0]?.kind, "sentence-too-long");
  assert.equal(sentence.items[0]?.sentenceIndex, 2);
  assert.equal(sentence.items[0]?.durationMs, 24_500);
  assert.equal(sentence.items[0]?.message, `第 2 句实测约 24.5 秒，超过单句 ${MAX_SHOT_DURATION_SECONDS} 秒，这句画面会停留偏久。`);

  // 恰好落在边界上不算违规；一句未测（总时长为 0）不误报过短。
  assert.equal(resolveNarrationDurationAdvisory(MIN_PRODUCTION_DURATION_SECONDS * 1_000, [8_000, 7_000]).items.length, 0);
  assert.equal(resolveNarrationDurationAdvisory(MAX_PRODUCTION_DURATION_SECONDS * 1_000, [20_000, 20_000, 20_000]).items.length, 0);
  assert.equal(resolveNarrationDurationAdvisory(40_000, [MAX_SHOT_DURATION_SECONDS * 1_000, 20_000]).items.length, 0);
  assert.equal(resolveNarrationDurationAdvisory(0, []).requiresAcknowledgement, false);

  // 多种软违规同时出现时全部列出，确认放行只看有没有。
  const combined = resolveNarrationDurationAdvisory(70_000, [30_000, 25_000, 15_000]);
  assert.equal(combined.items.length, 3);
  assert.deepEqual(combined.items.map((item) => item.kind), ["total-too-long", "sentence-too-long", "sentence-too-long"]);
  assert.equal(combined.requiresAcknowledgement, true);
});
