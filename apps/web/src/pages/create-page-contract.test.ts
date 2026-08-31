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
const css = read("styles/pages/production-runtime.css");
const surface = `${page}\n${forms}\n${composer}`;

test("制作首页拆成 composer / Agent 表单 / 历史列表子模块，路由仍挂 CreatePage", () => {
  assert.match(shell, /from "\.\.\/features\/production\/production-workbench-page"/u);
  assert.match(workbench, /from "\.\/production-composer-panel"/u);
  assert.match(workbench, /from "\.\/production-history-list"/u);
  assert.match(workbench, /from "\.\/production-setup-forms"/u);
  assert.match(page, /<ProductionComposerPanel/u);
  assert.match(page, /<ProductionHistoryList/u);
  assert.match(composer, /production-flow-switch/u);
  assert.match(composer, /aria-pressed/u);
  assert.match(composer, /<AgentSetupForm/u);
  assert.match(composer, /<ReplicaSetupForm/u);
  assert.match(history, /本地制作记录/u);
  assert.match(history, /展开全部/u);
  assert.match(history, /slice\(0, HISTORY_VISIBLE_COUNT\)/u);
});

test("composer 没有独立 pick 屏：默认直接进 Agent 表单，顶部分段切换两条做法", () => {
  assert.doesNotMatch(composer, /"pick"/u, "pick 屏已合并：composer 只有 agent / replica 两种做法");
  assert.match(workbench, /useState<ComposerFlow>\("agent"\)/u, "默认直接进智能成片表单");
  assert.match(composer, /智能成片/u);
  assert.match(composer, /爆款复刻/u);
  assert.match(composer, /aria-label="制作方式"/u);
  assert.match(composer, /role="group"/u);
  assert.match(page, /composerFlow/u);
});

test("数字人出镜只作为 Agent 流程里的二次选项，不改服务契约", () => {
  assert.match(page, /composerFlow === "agent"/u);
  assert.match(forms, /<Switch checked=\{avatarOn\}/u);
  assert.match(forms, /onMode\(checked \? "avatar" : "montage"\)/u);
  assert.doesNotMatch(page, /avatarScript/u, "新项目不再提交逐字稿：脚本由 AI 按需求生成，配音由应用完成");
  assert.doesNotMatch(page, /production-mode-grid/u, "不再用两列顶层单选把数字人和素材剪辑并列");
  assert.match(forms, /<strong>数字人出镜<\/strong>/u, "数字人只是 Agent 表单里的开关，不是独立做法");
  assert.match(forms, /上传一段数字人预处理视频，配音、字幕与画面裁剪拼接全部自动完成/u, "开关说明要讲清全自动范围");
});

test("Agent 文案不声称看懂或理解素材，并要求逐镜核对", () => {
  // 原入口卡 caveat 已迁移进 Agent 表单提示行，顺序约束不变。
  const caveat = forms.slice(forms.indexOf("这台安装不一定能看画面"));
  const fallbackAt = caveat.indexOf("看不到就按你的需求写");
  const referenceAt = caveat.indexOf("参考画面里看得见的内容");
  assert.ok(fallbackAt >= 0 && referenceAt >= 0 && fallbackAt < referenceAt, "盲配回退必须写在「会参考画面」前面");
  assert.match(forms, /不会核对文字是否对得上每个镜头/u);
  assert.match(forms, /逐镜核对/u);
  assert.match(forms, /这台安装不一定能看画面/u);
  assert.match(forms, /云端旁白，没配才用系统语音/u, "配音来源回退说明随入口卡文案一并迁移");
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
  assert.match(forms, /不代表画面里真的有这些内容/u);
  assert.match(forms, /绑错文件也不会被拦住/u, "入口卡 caveat 迁移进复刻表单提示，不丢失");
  assert.match(forms, /成片要回制作页合成/u);
});

test("数字人出镜如实描述能力：预处理视频加自动配音，不声称照片生成数字人", () => {
  assert.match(forms, /数字人预处理视频/u);
  assert.match(forms, /画面会自动循环裁剪凑齐时长/u, "偏短视频的处理方式要讲清：裁剪拼接，不是拒绝");
  assert.match(forms, /视频原声会被替换成应用的配音/u, "诚实说明原声被丢弃");
  assert.doesNotMatch(surface, /一张图片[\s\S]{0,40}数字人/u);
  assert.doesNotMatch(surface, /照片生成数字人/u);
  assert.doesNotMatch(page, /数字人口播[\s\S]{0,80}TTS/u);
  assert.doesNotMatch(page, /数字人口播[\s\S]{0,80}至少 3/u);
  assert.match(forms, /不需要 \{MIN_MONTAGE_VISUAL_ASSETS\} 份素材/u, "数字人路径不需要凑素材数量的说明随入口卡迁入表单");
});

test("做法分段切换与二次选项的触达高度不小于 44px，高级项折叠可展开", () => {
  assert.match(css, /\.production-flow-switch button \{[^}]*min-height: 3rem/u, "做法分段切换升到 48px 触控目标");
  assert.match(css, /\.production-entry-switch[\s\S]*min-height: 44px/u);
  assert.match(css, /\.production-avatar-option \{[^}]*min-height: 44px/u);
  assert.doesNotMatch(css, /\.production-entry-grid/u, "入口卡网格随 pick 屏一并移除");
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
  assert.match(page, /!brief\.trim\(\)/u);
  assert.doesNotMatch(forms, /production-avatar-script/u, "逐字稿输入已移除：数字人脚本由 AI 生成");
});

test("离开 Agent 会清掉失败，重试不会在选择屏上重建项目", () => {
  const enter = page.slice(page.indexOf("const enterComposer ="), page.indexOf("const startNewProduction"));
  assert.match(enter, /setIssue\(undefined\)/u);
  assert.match(enter, /if \(flow !== "agent"\) setMode\("montage"\)/u);
  assert.match(page, /if \(composerFlow === "replica"\)/u);
  assert.match(page, /startNewProduction/u);
  assert.match(page, /换一种做法/u);
  assert.match(page, /issue && showComposer && issue\.action === "none"/u);
  assert.match(page, /issue && showComposer && issue\.action !== "none"/u, "工作台错误由内联横幅承载，顶部通知只在 composer 出现");
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
  assert.match(composer, /production-flow-switch/u, "做法切换在表单顶部分段控件，头部不再放「更换」");
  assert.doesNotMatch(page, /production-header-switch/u);
  assert.match(forms, /这次想讲什么？/u);
  assert.match(forms, /按哪条拆解复刻？/u);
});

test("数字人开关打开即出现上传卡片：先传视频，未上传时一键制作被拦", () => {
  assert.match(forms, /data-avatar-upload/u);
  assert.match(forms, /上传数字人预处理视频/u);
  assert.match(forms, /上传后才能开始一键制作/u);
  assert.match(forms, /onPickAvatar/u);
  assert.match(forms, /onRemoveAvatar/u);
  assert.match(page, /mode === "avatar" && !avatarAsset/u, "未上传数字人视频时一键制作按钮禁用");
  assert.match(page, /先上传一段数字人预处理视频，再开始一键制作/u, "兜底提示指向真实缺口，不甩通用错误");
  assert.match(page, /avatarDraft/u);
  assert.match(page, /runtime\.production\.importAssets\(draft\.projectId\)/u, "数字人视频走同一素材导入权威端口");
  assert.match(page, /mode === "avatar" && avatarDraft/u, "一键制作复用上传草稿，不二次创建项目");
});

test("新建编排不叠加旧项目：composer 期间不选中任何项目，失败兜底不刷错对象", () => {
  assert.match(page, /composingNewRef\.current \|\| composeEntry \|\| requestedSourceId/u, "composer 模式下不得把列表第一条塞进选中态");
  assert.match(page, /return composingNewRef\.current \? undefined : remaining\[0\]/u, "新建失败保持无选中，不拉旧项目顶包");
  assert.match(page, /!composingNewRef\.current && project\?\.projectId/u, "失败兜底只刷新当前真实选中的项目");
  assert.match(page, /if \(contextGenerationRef\.current === generation && !composingNewRef\.current\) \{\s*setIssue/u, "已离开原上下文的迟到失败不得补写错误提示");
  assert.match(page, /contextGenerationRef\.current \+= 1/u, "进入 composer 必须同步递增上下文代际");
  const fresh = page.slice(page.indexOf("const startNewProduction ="));
  assert.match(fresh, /setProject\(undefined\)/u, "再做一条必须清掉旧项目选中态");
});
