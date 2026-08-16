import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { productionRenderStageCopy } from "./CreatePage";
import {
  PRODUCTION_PRIMARY_LABELS,
  PRODUCTION_WORKBENCH_TABS,
  productionPlanReady,
  productionPreviewSource,
  resolveProductionPrimaryAction,
  resolveProductionRetryKind,
  resolveProductionRetryOperation,
  resolveProductionWorkbenchStage,
} from "./production-workbench-model";

const webRoot = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

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
    "no-project": "一键制作视频",
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

  assert.equal(resolveProductionPrimaryAction({}).label, "一键制作视频");
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
});

test("制作页用 contextualAction 单主按钮、三 Tab 与 9:16 预览，完成态没有发布入口", () => {
  const page = read("pages/CreatePage.tsx");
  const card = read("components/ProductionProjectCard.tsx");
  const css = read("styles/pages/production-runtime.css");
  const model = read("pages/production-workbench-model.ts");
  const surface = `${page}\n${card}\n${css}\n${model}`;

  assert.match(page, /contextualAction=\{/);
  assert.match(page, /resolveProductionPrimaryAction/);
  assert.match(page, /setComposingNew\(true\)/);
  assert.match(page, /一键制作视频|primary\.label/);
  assert.match(page, /runtime\.production\.create/);
  assert.match(page, /runtime\.production\.importAssets/);
  assert.match(page, /runtime\.production\.generatePlan/);
  assert.match(page, /runtime\.production\.render/);
  assert.match(page, /参考哪条拆解/);
  assert.match(page, /这次想讲什么/);
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
