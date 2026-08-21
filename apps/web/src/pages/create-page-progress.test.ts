import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { productionRenderStageCopy } from "./CreatePage";
import {
  PRODUCTION_PRIMARY_LABELS,
  PRODUCTION_WORKBENCH_TABS,
  productionComposerBlockedReason,
  productionPlanBlockedReason,
  productionPlanReady,
  productionPreviewSource,
  productionPrimaryBlockedReason,
  resolveProductionPrimaryAction,
  resolveProductionRetryKind,
  resolveProductionRetryOperation,
  resolveProductionWorkbenchStage,
} from "./production-workbench-model";

const webRoot = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");
const page = read("pages/CreatePage.tsx");
const forms = read("features/production/production-setup-forms.tsx");
const createSurface = `${page}\n${forms}`;

test("制作进度文案只按稳定 stage 白名单映射，未知 stage 不猜业务", () => {
  assert.equal(productionRenderStageCopy("validate_avatar_audio"), "正在校验数字人口播原声");
  assert.equal(productionRenderStageCopy("synthesize_narration"), "正在生成旁白");
  assert.equal(productionRenderStageCopy("compile_shots"), "正在编排镜头");
  assert.equal(productionRenderStageCopy("export"), "正在本地合成");
  assert.equal(productionRenderStageCopy("saved"), "成片已保存");
  assert.equal(productionRenderStageCopy(""), "正在本地合成");
  assert.equal(productionRenderStageCopy("unknown_future_stage"), "正在本地合成");
  assert.equal(productionRenderStageCopy("正在生成旁白"), "正在本地合成");
});

test("制作页主按钮只使用 Issue 七行阶段，文案不得自创", () => {
  assert.deepEqual(PRODUCTION_WORKBENCH_TABS, ["预览", "文案", "素材"]);
  assert.deepEqual(PRODUCTION_PRIMARY_LABELS, {
    "no-project": "创建制作项目",
    "no-assets": "添加素材",
    "no-plan": "AI 生成制作计划",
    "no-output": "开始本地合成",
    rendering: "正在本地合成",
    "has-output": "再做一条",
    failed: "重试",
  });

  assert.equal(resolveProductionWorkbenchStage({}), "no-project");
  assert.equal(resolveProductionWorkbenchStage({ composingNew: true, project: { status: "succeeded", assets: [{}], plan: {}, output: {} } }), "no-project");
  assert.equal(resolveProductionWorkbenchStage({ project: { status: "draft", assets: [] } }), "no-assets");
  assert.equal(resolveProductionWorkbenchStage({ project: { status: "draft", assets: [{}] } }), "no-plan");
  assert.equal(resolveProductionWorkbenchStage({ project: { status: "ready", assets: [{}], plan: {} } }), "no-output");
  assert.equal(resolveProductionWorkbenchStage({ project: { status: "rendering", assets: [{}], plan: {} } }), "rendering");
  assert.equal(resolveProductionWorkbenchStage({ project: { status: "succeeded", assets: [{}], plan: {}, output: {} } }), "has-output");
  assert.equal(resolveProductionWorkbenchStage({ project: { status: "failed", assets: [{}], plan: {}, output: {} } }), "failed");
  assert.equal(resolveProductionWorkbenchStage({ project: { status: "planning", assets: [{}] } }), "no-plan");

  assert.equal(resolveProductionPrimaryAction({}).label, "创建制作项目");
  assert.equal(resolveProductionPrimaryAction({ project: { status: "draft", assets: [] } }).label, "添加素材");
  assert.equal(resolveProductionPrimaryAction({ project: { status: "draft", assets: [] } }).disabled, false);
  assert.equal(resolveProductionPrimaryAction({ project: { status: "draft", assets: [] }, importBlocked: true }).disabled, true);
  assert.equal(resolveProductionPrimaryAction({ project: { status: "draft", assets: [{}] }, planReady: true }).label, "AI 生成制作计划");
  assert.equal(resolveProductionPrimaryAction({ project: { status: "ready", assets: [{}], plan: {} } }).label, "开始本地合成");
  assert.equal(resolveProductionPrimaryAction({ project: { status: "rendering", assets: [{}], plan: {} } }).disabled, true);
  assert.equal(resolveProductionPrimaryAction({ project: { status: "succeeded", assets: [{}], plan: {}, output: {} } }).label, "再做一条");
  assert.equal(resolveProductionPrimaryAction({ project: { status: "failed", assets: [{}] } }).label, "重试");
  assert.equal(resolveProductionPrimaryAction({ project: { status: "draft", assets: [{}] }, planReady: false }).disabled, true);
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
  assert.equal(productionPlanReady({
    mode: "montage",
    assets: [{ role: "visual" }, { role: "visual" }, { role: "visual" }],
    targetDurationSeconds: 30,
  }), true);
  assert.equal(productionPlanReady({
    mode: "montage",
    assets: [{ role: "visual" }, { role: "visual" }],
    targetDurationSeconds: 30,
  }), false);
  assert.equal(productionPlanBlockedReason({
    mode: "montage",
    assets: [{ role: "visual" }, { role: "visual" }],
    targetDurationSeconds: 30,
  }), "至少还要 1 个图片或视频素材，才能生成制作计划。");
  assert.equal(productionPlanBlockedReason({
    mode: "avatar",
    assets: [],
    targetDurationSeconds: 15,
  }), "请先上传一个带原声的 MP4 数字人口播视频。");
  assert.equal(productionComposerBlockedReason({
    replica: false,
    sourceId: "",
    brief: "门店活动",
    avatarMode: false,
    avatarScript: "",
  }), "先选一条已经拆解成功的内容。");
  assert.equal(productionComposerBlockedReason({
    replica: false,
    sourceId: "task-1",
    brief: "",
    avatarMode: false,
    avatarScript: "",
  }), "先填写这次想讲什么。");
  assert.equal(productionPrimaryBlockedReason({
    stage: "no-plan",
    planReady: false,
    planBlockedReason: "至少还要 1 个图片或视频素材，才能生成制作计划。",
  }), "至少还要 1 个图片或视频素材，才能生成制作计划。");
  assert.equal(productionPrimaryBlockedReason({ stage: "rendering", busy: false }), "");
});

test("制作页用 contextualAction 单主按钮、三 Tab 与 9:16 预览，完成态没有发布入口", () => {
  const page = read("pages/CreatePage.tsx");
  const card = read("components/ProductionProjectCard.tsx");
  const css = read("styles/pages/production-runtime.css");
  const model = read("pages/production-workbench-model.ts");
  const surface = `${page}\n${card}\n${css}\n${model}`;

  assert.match(page, /contextualAction=\{/);
  assert.doesNotMatch(page, /contextual-action-hint/);
  assert.doesNotMatch(page, /contextual-action-stack/);
  assert.doesNotMatch(page, /productionPrimaryBlockedReason/);
  assert.doesNotMatch(page, /productionComposerBlockedReason/);
  assert.match(read("styles/components.css"), /\.contextual-action \.button:not\(:disabled\)\s*\{[^}]*pointer-events:\s*auto/s);
  assert.match(read("styles/components.css"), /\.contextual-action\s*\{[^}]*pointer-events:\s*none/s);
  assert.doesNotMatch(read("styles/components.css"), /\.contextual-action > \*\s*\{[^}]*pointer-events:\s*auto/s);
  assert.doesNotMatch(read("styles/components.css"), /\.contextual-action-hint/);
  assert.match(card, /productionPlanBlockedReason/);
  assert.match(page, /resolveProductionPrimaryAction/);
  assert.match(page, /setComposingNew\(true\)/);
  assert.match(page, /创建制作项目|primary\.label/);
  assert.match(page, /runtime\.production\.create/);
  assert.match(page, /runtime\.production\.importAssets/);
  assert.match(page, /runtime\.production\.generatePlan/);
  assert.match(page, /runtime\.production\.render/);
  assert.match(createSurface, /参考哪条拆解/);
  assert.match(createSurface, /这次想讲什么/);
  assert.doesNotMatch(page, /新建制作项目/);
  assert.doesNotMatch(page, />01</);
  assert.doesNotMatch(page, /发布/);

  assert.match(card, /from "\.\/Tabs"/);
  assert.match(card, /<Tabs\b/);
  assert.match(card, /<TabPanel\b/);
  assert.match(card, /PRODUCTION_WORKBENCH_TABS/);
  assert.match(card, /project\.issue/);
  assert.match(card, /production-render-progress/);
  assert.match(card, /确认删除成片/);
  assert.match(card, /确认删除项目/);
  assert.match(card, /重新生成计划/);
  assert.doesNotMatch(card, /本地合成视频/);
  assert.doesNotMatch(card, /production-actions/);
  assert.doesNotMatch(card, /发布/);
  assert.doesNotMatch(card, />02</);

  assert.match(css, /aspect-ratio:\s*9\s*\/\s*16/);
  assert.match(css, /max-width:\s*17\.5rem/);
  assert.match(css, /padding-bottom:\s*calc\(/);
  assert.doesNotMatch(surface, /时间轴|逐帧|转场编辑/);
});

test("制作页回到前台会消费素材恢复，且成功或失败才清 busy", () => {
  const page = read("pages/CreatePage.tsx");
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

  const page = read("pages/CreatePage.tsx");
  const model = read("pages/task-page-model.ts");
  assert.match(page, /resolveCreateWorkbenchEntry/);
  assert.match(page, /status:\s*"degraded"/);
  assert.match(page, /sourceMatchFailed/);
  assert.match(page, /CONTENT_NOT_FOUND/);
  assert.match(model, /status === "degraded"|status === 'degraded'/);
  const again = page.slice(page.indexOf("primary.stage === \"has-output\""), page.indexOf("primary.stage === \"failed\""));
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

  const page = read("pages/CreatePage.tsx");
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
    else (globalThis as { window: unknown }).window = previousWindow;
  }
});
