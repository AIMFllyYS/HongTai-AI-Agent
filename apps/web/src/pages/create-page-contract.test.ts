import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { matchRoute, pathForRoute, replicaWizardPath } from "../router";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

const page = read("pages/CreatePage.tsx");
const entry = read("components/ProductionModeEntry.tsx");
const css = read("styles/pages/production-runtime.css");
const surface = `${page}\n${entry}`;

test("制作首页只有两张顶层入口卡，数字人不是第三张", () => {
  assert.equal([...entry.matchAll(/data-production-entry="/gu)].length, 2, "第一屏只能有两张入口卡");
  assert.match(entry, /data-production-entry="agent"/u);
  assert.match(entry, /data-production-entry="replica"/u);
  assert.doesNotMatch(entry, /data-production-entry="avatar"/u);
  assert.match(entry, /<strong>Agent 模式<\/strong>/u);
  assert.match(entry, /<strong>爆款复刻<\/strong>/u);
  assert.match(page, /<ProductionModeEntry /u);
  assert.match(page, /composerFlow === "pick"/u);
});

test("数字人口播只作为 Agent 流程里的二次选项，不改服务契约", () => {
  assert.match(page, /composerFlow === "agent"/u);
  assert.match(page, /aria-pressed=\{mode === "avatar"\}/u);
  assert.match(page, /onMode\(avatarOn \? "montage" : "avatar"\)/u);
  assert.match(page, /mode === "avatar" \? \{ avatarScript \}/u, "提交给 production.create 的仍是既有 mode + avatarScript");
  assert.doesNotMatch(page, /production-mode-grid/u, "不再用两列顶层单选把数字人和素材剪辑并列");
  assert.match(entry, /也可以改用数字人口播/u, "入口卡只提示下一步有这个选项，本身不是第三张卡");
});

test("Agent 文案不声称看懂或理解素材，并要求逐镜核对", () => {
  assert.match(entry, /旁白会参考画面里看得见的内容/u);
  assert.match(entry, /逐镜核对/u);
  assert.match(page, /逐镜核对/u);
  assert.match(page, /不会核对文字是否对得上每个镜头/u);

  // 看不看得到画面取决于运行环境：浏览器和没有取帧插件的旧 APK 一律盲配。
  // 承诺「会参考画面」在那些环境里是空话，所以两张卡都要把回退说在前面。
  assert.match(entry, /看不到就按拆解结构写/u);
  assert.match(page, /看不到就按拆解结构写/u);
  assert.doesNotMatch(surface, /看懂/u);
  assert.doesNotMatch(surface, /理解你的素材/u);
  assert.doesNotMatch(surface, /智能识别并匹配/u);
  assert.doesNotMatch(surface, /深度理解/u);
  assert.doesNotMatch(surface, /AI 看懂你的素材/u);
});

test("爆款复刻走既有向导，没有拆解时说明下一步并导向拆解", () => {
  assert.match(page, /navigate\(replicaWizardPath\(sourceId\)\)/u);
  assert.equal(replicaWizardPath("task-1"), "/replica/task-1");
  assert.equal(matchRoute("/replica/task-1").key, "replica-wizard");
  assert.equal(pathForRoute("home"), "/");
  assert.doesNotMatch(page, /runtime\.replica/u, "制作首页只负责选来源并跳转，不复制向导");
  assert.match(page, /去拆解一条/u);
  assert.match(page, /navigate\(pathForRoute\("home"\)\)/u);
  assert.match(entry, /不代表画面里真的有这些内容/u);
  assert.match(entry, /成片仍要回制作页合成/u);
});

test("数字人口播不承诺素材剪辑才有的能力", () => {
  assert.match(page, /只按稿烧字幕，不合成语音，也不改原声/u);
  assert.match(page, /生成后不能改口播和单镜时长/u);
  assert.match(page, /切分按字数估算，不是对着录音识别的/u);
  assert.doesNotMatch(page, /数字人口播[\s\S]{0,80}TTS/u);
  assert.doesNotMatch(page, /数字人口播[\s\S]{0,80}至少 3/u);
});

test("入口卡与二次选项的触达高度不小于 44px", () => {
  assert.match(css, /\.production-entry-card \{[^}]*min-height: 44px/u);
  assert.match(css, /\.production-entry-switch \{[^}]*min-height: 44px/u);
  assert.match(css, /\.production-avatar-option \{[^}]*min-height: 44px/u);
  assert.match(css, /\.production-entry-grid \{[^}]*grid/u);
  assert.doesNotMatch(css, /\.production-entry-grid \{[^}]*grid-template-columns:\s*repeat\(2/u, "390px 下两张长文案卡必须上下排，不能挤成两列");
});
