import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { matchRoute, pathForRoute, productionEditPath } from "../router";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

const page = read("pages/ProductionEditPage.tsx");
const card = read("components/ProductionShotEditCard.tsx");

test("微调页有自己的路由，项目标识始终编码后进入路径", () => {
  assert.equal(productionEditPath("project-1"), "/create/project-1/edit");
  assert.equal(productionEditPath("a/b?c"), "/create/a%2Fb%3Fc/edit");

  const matched = matchRoute("/create/project-1/edit");
  assert.equal(matched.key, "production-edit");
  assert.deepEqual(matched.params, { projectId: "project-1" });
  assert.equal(matchRoute("/create").key, "create", "微调路由不能吃掉制作首页");
  assert.equal(pathForRoute("create"), "/create");
});

test("版本过期时重新读取计划，绝不复用会触发本地合成的重试路径", () => {
  assert.match(page, /PRODUCTION_PLAN_VERSION_STALE/u);
  assert.match(page, /retry:\s*issue\.code === "PRODUCTION_PLAN_VERSION_STALE" \? load : save/u);
  assert.doesNotMatch(page, /resolveProductionRetryOperation|resolveProductionRetryKind/u, "微调页不能借用制作页的重试映射");
  assert.doesNotMatch(page, /production\.render|production\.generatePlan/u, "微调页不负责合成或重新规划");
});

test("微调不提交字幕时间，并如实说清哪些东西在这里改不了", () => {
  assert.doesNotMatch(`${page}\n${card}`, /startMs:|endMs:|cues:\s*\[/u, "字幕时间由共享层重算，界面不能提交");
  assert.match(card, /字幕的切分和进出点由文案与模板决定/u);
  assert.match(page, /镜头的数量、顺序和画面比例在这里不能改/u);
});

test("字幕模板选择器与预览真的被挂到微调页，并按真实精度判断是否降级", () => {
  assert.match(page, /<SubtitleTemplatePicker/u);
  assert.match(card, /<SubtitleTemplatePreview/u);
  assert.match(page, /hasWordTiming=\{plan\.subtitle\?\.precision === "word"\}/u, "词级时间要按计划里的真实精度判断，不能写死 true");
  assert.doesNotMatch(page, /hasWordTiming=\{true\}/u);
});

test("数字人模式锁住口播与时长，并说明原因", () => {
  assert.match(page, /lockedCopy=\{avatarMode\}/u);
  assert.match(card, /disabled=\{disabled \|\| lockedCopy\}/u);
  assert.match(card, /字幕就是数字人视频里说出的话/u);
});

test("如实提示偏短字幕、成片会被作废、以及字幕时间只是按字数推算", () => {
  assert.match(card, /短于 0\.6 秒/u);
  assert.match(page, /保存微调会把它作废/u);
  assert.match(page, /来源是文字长度而不是真实语音/u);
});
