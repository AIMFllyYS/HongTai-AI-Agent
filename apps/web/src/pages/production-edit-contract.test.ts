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

test("版本过期不走共享通知，改用能说清后果、也能执行的冲突提示", () => {
  assert.match(page, /issue\.code !== "PRODUCTION_PLAN_VERSION_STALE"/u, "过期码不能交给把 retry 当成本地合成的共享通知");
  assert.match(page, /现在保存会被拒绝/u, "必须说清保留旧版本号意味着这次保存不会落盘");
  assert.doesNotMatch(page, /resolveProductionRetryOperation|resolveProductionRetryKind/u, "微调页不能借用制作页的重试映射");
  assert.doesNotMatch(page, /production\.render|production\.generatePlan/u, "微调页不负责合成或重新规划");
});

test("外部写入不刷新版本令牌，未保存的改动既不被覆盖也不被静默丢弃", () => {
  assert.match(page, /if \(dirty\) setConflict\(event\.project\);\s*\n\s*else adopt\(event\.project\);/u);
  assert.match(page, /expectedUpdatedAt: base\.updatedAt/u, "版本令牌只能来自草稿所依据的那份记录");
  assert.doesNotMatch(page, /setStale/u, "不能在状态更新函数里做副作用");
  // 过期后重新读取的是“对照用的最新计划”，不能覆盖用户还看得见的草稿。
  assert.match(page, /const latest = await runtime\.production\.get\(projectId\)/u);
  assert.doesNotMatch(page, /VERSION_STALE"\) \{\s*\n\s*.*await load\(\)/u, "过期分支不能整页重载，否则提示和草稿都会被清掉");
});

test("字段级错误把服务端说的那一项显示出来，不被通用标题盖住", () => {
  assert.match(page, /isInlineIssueAction\(issue\.action\)/u);
  assert.match(page, /issue\.userMessage/u, "#108 按字段给的原因必须可见");
});

test("主文字不能被清空，因为服务端会把空值读成保持原样", () => {
  assert.match(page, /planDraftProblem/u);
  assert.match(page, /required/u);
});

test("字幕预览按当前草稿重算，不展示上次保存的出入点", () => {
  assert.match(page, /previewShot\(\{ shot, requestedTemplateId: draft\.subtitleTemplateId \}\)/u);
  assert.doesNotMatch(card, /shot\.cues/u, "卡片不能再读已保存计划的 cue");
  assert.doesNotMatch(page, /shortCueCount/u, "偏短字幕要按草稿数，而不是按上次保存的结果");
  assert.match(card, /hasWordTiming=\{false\}/u, "微调只会产出估算时间，预览不能假装能逐字点亮");
});

test("微调不提交字幕时间，并如实说清哪些东西在这里改不了", () => {
  assert.doesNotMatch(`${page}\n${card}`, /startMs:|endMs:|cues:\s*\[/u, "字幕时间由共享层重算，界面不能提交");
  assert.match(card, /由文案、时长和模板一起决定，不能在这里逐条拖动/u);
  assert.match(page, /镜头的数量、顺序和画面比例在这里不能改/u);
});

test("字幕模板选择器与预览真的被挂到微调页，并按真实精度判断是否降级", () => {
  assert.match(page, /<SubtitleTemplatePicker/u);
  assert.match(card, /<SubtitleTemplatePreview/u);
  assert.match(card, /<ProductionDecorationPreview/u);
  assert.match(card, /decorationPublicUrl|decorations=\{decorations\}/u);
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

test("如实告诉用户这条口播是看着画面写的还是照拆解结构写的", () => {
  // Both cases look identical on screen otherwise, and a user who is not told will keep
  // regenerating in the hope of something the system never did.
  assert.match(page, /visualGrounding === "blind"/u);
  assert.match(page, /系统没有看过你上传的画面/u);
  assert.match(page, /visualGrounding === "asset_insight"/u);
  assert.match(page, /describedAssetIds\.length/u, "看过几个就说几个，不说成全部");
  assert.match(page, /其余素材仍按拆解结构写/u);

  // Looking and failing to read is not the same as never looking: one is fixed by reshooting, the
  // other by proofreading. Reporting the first as the second sends the user to the wrong repair.
  assert.match(page, /reshootAdvice !== undefined/u);
  assert.match(page, /unreadableAssets\.length > 0/u);
  assert.match(page, /系统看过你上传的画面，但有/u);
  assert.match(page, /重拍那几个素材会比改文字更有用/u);
  assert.match(page, /看不清的素材：/u, "必须把重拍建议本身显示出来，而不是只说有几个看不清");

  // #112 never compares "what the list asked for" against "what the picture shows", so the page
  // must not let being described be read as having been checked.
  assert.match(page, /没有核对你拍的是不是该拍的那一项/u);
});
