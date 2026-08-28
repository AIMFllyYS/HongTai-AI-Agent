import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { matchRoute, pathForRoute, replicaWizardPath } from "../router";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

const shell = read("pages/CreatePage.tsx");
const workbench = read("features/production/production-workbench-page.tsx");
const page = `${shell}\n${workbench}`;
const forms = read("features/production/production-setup-forms.tsx");
const composer = read("features/production/production-composer-panel.tsx");
const history = read("features/production/production-history-list.tsx");
const entry = read("components/ProductionModeEntry.tsx");
const css = read("styles/pages/production-runtime.css");
const surface = `${page}\n${entry}\n${forms}\n${composer}`;

test("制作首页拆成入口 / Agent 表单 / 历史列表子模块，路由仍挂 CreatePage", () => {
  assert.match(shell, /from "\.\.\/features\/production\/production-workbench-page"/u);
  assert.match(workbench, /from "\.\/production-composer-panel"/u);
  assert.match(workbench, /from "\.\/production-history-list"/u);
  assert.match(workbench, /from "\.\/production-setup-forms"/u);
  assert.match(page, /<ProductionComposerPanel/u);
  assert.match(page, /<ProductionHistoryList/u);
  assert.match(composer, /<ProductionModeEntry /u);
  assert.match(composer, /<AgentSetupForm/u);
  assert.match(composer, /<ReplicaSetupForm/u);
  assert.match(history, /本地制作记录/u);
});

test("制作首页只有两张顶层入口卡，数字人不是第三张", () => {
  assert.equal([...entry.matchAll(/data-production-entry="/gu)].length, 2, "第一屏只能有两张入口卡");
  assert.match(entry, /data-production-entry="agent"/u);
  assert.match(entry, /data-production-entry="replica"/u);
  assert.doesNotMatch(entry, /data-production-entry="avatar"/u);
  assert.match(entry, /<strong>智能成片<\/strong>/u);
  assert.match(entry, /<strong>爆款复刻<\/strong>/u);
  assert.match(composer, /flow === "pick"/u);
  assert.match(page, /composerFlow/u);
});

test("口播切片只作为 Agent 流程里的二次选项，不改服务契约", () => {
  assert.match(page, /composerFlow === "agent"/u);
  assert.match(forms, /<Switch checked=\{avatarOn\}/u);
  assert.match(forms, /onMode\(checked \? "avatar" : "montage"\)/u);
  assert.match(page, /mode === "avatar" \? \{ avatarScript \}/u, "提交给 production.create 的仍是既有 mode + avatarScript");
  assert.doesNotMatch(page, /production-mode-grid/u, "不再用两列顶层单选把口播切片和素材剪辑并列");
  assert.match(entry, /口播切片是下一步里的开关/u, "入口卡只提示下一步有这个选项，本身不是第三张卡");
  assert.match(forms, /不生成数字人形象/u, "开关说明要诚实：只切片，不生成形象");
});

test("Agent 文案不声称看懂或理解素材，并要求逐镜核对", () => {
  const caveat = entry.slice(entry.indexOf("production-entry-card__caveat"));
  const fallbackAt = caveat.indexOf("看不到就按你的需求写");
  const referenceAt = caveat.indexOf("参考画面里看得见的内容");
  assert.ok(fallbackAt >= 0 && referenceAt >= 0 && fallbackAt < referenceAt, "盲配回退必须写在「会参考画面」前面");
  assert.match(entry, /不会核对文字是否对得上每个镜头/u);
  assert.match(entry, /逐镜核对/u);
  assert.match(forms, /不会核对文字是否对得上每个镜头/u);
  assert.match(forms, /这台安装不一定能看画面/u);
  assert.doesNotMatch(entry, /并在本地合成/u);
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
  assert.match(forms, /去拆解一条/u);
  assert.match(page, /navigate\(pathForRoute\("home"\)\)/u);
  assert.match(entry, /不代表画面里真的有这些内容/u);
  assert.match(entry, /成片仍要回制作页合成/u);
});

test("口播切片不承诺素材剪辑才有的能力", () => {
  assert.match(forms, /只按稿烧字幕，不合成语音，也不改原声/u);
  assert.match(forms, /生成后不能改口播和单镜时长/u);
  assert.match(forms, /切分按字数估算，不是对着录音识别的/u);
  assert.doesNotMatch(page, /数字人口播[\s\S]{0,80}TTS/u);
  assert.doesNotMatch(page, /数字人口播[\s\S]{0,80}至少 3/u);
  assert.doesNotMatch(entry, /数字人口播[\s\S]{0,80}至少 3/u);
  assert.match(entry, /不需要 \{MIN_MONTAGE_VISUAL_ASSETS\} 份素材/u);
});

test("入口卡与二次选项的触达高度不小于 44px，高级项折叠可展开", () => {
  assert.match(css, /\.production-entry-card \{[^}]*min-height: 44px/u);
  assert.match(css, /\.production-entry-card:focus-visible/u);
  assert.match(css, /\.production-entry-switch[\s\S]*min-height: 44px/u);
  assert.match(css, /\.production-avatar-option \{[^}]*min-height: 44px/u);
  assert.match(css, /\.production-entry-grid \{[^}]*grid/u);
  assert.doesNotMatch(css, /\.production-entry-grid \{[^}]*grid-template-columns:\s*repeat\(2/u, "390px 下两张长文案卡必须上下排，不能挤成两列");
  assert.doesNotMatch(forms, /production-duration-segmented/u, "时长四选一已移除：时长由文稿与实测配音驱动");
  assert.doesNotMatch(forms, /\[15, 30, 45, 60\]/u);
  assert.doesNotMatch(css, /\.production-duration-segmented/u);
  assert.match(forms, /<details className="production-advanced">/u, "参考拆解、主文字、文字预设折叠进高级选项");
  assert.match(forms, /<summary>高级选项/u);
  assert.match(css, /\.production-advanced__body \{[^}]*grid/u);
  assert.match(css, /\.production-advanced > summary \{[^}]*min-height: 44px/u);
});

test("一句话需求是唯一必填主字段，无拆解也能直接开始", () => {
  assert.match(forms, /id="production-brief"/u);
  assert.doesNotMatch(forms, /还没有可用于制作的拆解/u, "Agent 表单不再拿拆解当创建前置");
  assert.match(forms, /还没有可参考的拆解/u, "无拆解时高级选项里诚实说明，并保留去拆解入口");
  assert.match(forms, /一句话需求也能直接开始/u);
  assert.doesNotMatch(page, /!sourceId \|\| !brief\.trim\(\)/u, "sourceId 不再阻断创建");
  assert.match(page, /!brief\.trim\(\) \|\| mode === "avatar" && !avatarScript\.trim\(\)/u);
  assert.match(forms, /口播切片逐字稿/u, "口播稿输入随开关显示，命名对齐口播切片");
});

test("离开 Agent 会清掉失败，重试不会在选择屏上重建项目", () => {
  const enter = page.slice(page.indexOf("const enterComposer ="), page.indexOf("const startNewProduction"));
  assert.match(enter, /setIssue\(undefined\)/u);
  assert.match(enter, /if \(flow !== "agent"\) setMode\("montage"\)/u);
  assert.match(page, /if \(composerFlow === "pick"\) return/u);
  assert.match(page, /startNewProduction/u);
  assert.match(page, /换一种做法/u);
  assert.match(page, /issue && !\(showComposer && issue\.action === "none"\)/u);
  assert.match(page, /issue && showComposer && issue\.action === "none"/u);
});

test("用它做视频会跳过两张卡，直接进入 Agent 表单", () => {
  const load = page.slice(page.indexOf("const load = useCallback"), page.indexOf("}, [runtime, searchEpoch]);"));
  assert.match(load, /setComposingNew\(true\)/u);
  assert.ok(load.indexOf("setComposingNew(true)") < load.indexOf("setComposerFlow(\"agent\")"));
  assert.match(load, /setComposerFlow\("agent"\)/u);
});

test("加号入口通过 entry 查询参数直接打开 Agent 或复刻表单，页头文案对齐稿面", () => {
  const load = page.slice(page.indexOf("const load = useCallback"), page.indexOf("}, [runtime, searchEpoch]);"));
  assert.match(page, /composeEntryFromSearch/u);
  assert.match(page, /consumeComposeEntryFromSearch/u);
  assert.match(load, /setComposerFlow\(composeEntry\)/u);
  assert.ok(load.indexOf("requestedSourceId") < load.indexOf("composeEntry"), "拆解详情的 sourceId 优先于加号 entry");
  assert.match(page, /智能成片/u);
  assert.match(page, /爆款复刻/u);
  assert.match(page, /production-header-switch/u);
  assert.match(page, />更换</u);
  assert.match(forms, /这次想讲什么？/u);
  assert.match(forms, /按哪条拆解复刻？/u);
});
