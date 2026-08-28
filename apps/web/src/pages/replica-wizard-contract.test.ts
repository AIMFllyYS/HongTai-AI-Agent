import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { matchRoute, replicaWizardPath, taskDetailPath } from "../router";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

const page = read("pages/ReplicaWizardPage.tsx");
const card = read("components/ReplicaRequirementCard.tsx");
const view = read("features/replica/replica-blueprint-view.ts");
const css = read("styles/pages/replica-wizard.css");

test("向导有自己的路由，任务标识编码后进入路径，且不吃掉任务详情", () => {
  assert.equal(replicaWizardPath("task-1"), "/replica/task-1");
  assert.equal(replicaWizardPath("a/b?c"), "/replica/a%2Fb%3Fc");

  const matched = matchRoute("/replica/task-1");
  assert.equal(matched.key, "replica-wizard");
  assert.deepEqual(matched.params, { taskId: "task-1" });
  assert.equal(matchRoute(taskDetailPath("task-1")).key, "task-detail");
});

test("向导回到前台会消费素材恢复，失败时清掉 pending", () => {
  assert.match(page, /useAppResume\(\(\) => \{\s*void applyAssetRecovery\(\);/u);
  assert.doesNotMatch(page, /useAppResume\(\(\) => \{\s*void load\(\);/u);
  assert.match(page, /recovered\.status === "failed"[\s\S]*setPending\(undefined\)/u);
});

test("向导逐项绑定，数字人路径单视频导入", () => {
  assert.match(page, /importAssets\(project\.projectId, \{ requirementOrder: order \}\)/u, "每次导入都要说明这是哪一项的素材");
  assert.match(page, /bindAvatar[\s\S]*?importAssets\(project\.projectId\)\)/u, "数字人路径不带清单项：项目模式已把选择器钉死为单视频");
});

test("数字人单视频路径：一键入口绕过三项绑定门禁", () => {
  assert.match(page, /startProject\(taskId, mode \? \{ mode \} : undefined\)/u, "建项目要能把模式传给服务层");
  assert.match(page, /用一段数字人视频出镜/u, "开始卡片上要给出数字人替代路径");
  assert.match(page, /project\?\.mode === "avatar"/u, "向导按项目模式分流两种素材准备方式");
  assert.match(page, /画面会按每句配音自动裁剪拼接/u, "要说清偏短视频的循环补齐处理");
  assert.match(page, /原声会被应用的配音替换/u, "要诚实说明原声被丢弃");
  assert.match(page, /busy \|\| !avatarAsset/u, "生成分镜脚本要等数字人视频就绪");
});

test("向导不借用制作页的重试映射，也不自己合成成片", () => {
  assert.doesNotMatch(page, /resolveProductionRetryOperation|resolveProductionRetryKind/u, "制作页的 retry 会直接开始合成或重新规划");
  assert.doesNotMatch(page, /production\.render/u, "向导只负责准备素材和生成计划，导出在别处");
});

test("失败提示上的重试重做失败的那一步，不会跳去生成计划", () => {
  assert.match(page, /retry: \(\) => \{ void run\(kind, operation, fallback\); \}/u, "重试要复用失败时那一次调用");
  assert.doesNotMatch(page, /retry: project \? compose : start/u, "导入失败时按阶段猜重试动作会跑去规划");
});

test("绑定关系只从素材读，向导不另存一份自己的完成状态", () => {
  assert.match(view, /asset\.requirementOrder === undefined \? \[\] : \[\[asset\.requirementOrder, asset\]/u);
  assert.doesNotMatch(page, /useState<[^>]*Record<number/u, "页面不能再存一份“哪项已完成”，否则删素材后会对不上");
});

test("素材齐了以后生成的是分镜脚本，而不是假装已经出片", () => {
  assert.match(page, /generateScript\(project\.projectId\)/u);
  assert.match(page, /navigate\(pathForRoute\("create"\)\)/u);
  assert.match(page, /再回制作页合成成片/u, "要说清这一步只出脚本和字幕，成片还没做");
  assert.match(page, /系统语音/u, "要说清云端配音失败时会回退系统语音，而不是假装一定有云端旁白");
  assert.doesNotMatch(page, /素材齐了以后自动生成/u, "向导不能把生成计划和本地合成说成同一个自动步骤");
});

test("清单项的脚本草稿被标成参考，不承诺就是最终口播", () => {
  assert.match(card, /最终口播会按你真正绑定的素材重写/u);
});

test("清单只说该拍什么，页面不声称它看懂了画面里有什么", () => {
  assert.match(page, /不代表画面里真的有这些内容/u);
});

test("顺序保证按校验器实际做的说：相对顺序压紧，不是第 i 项一定进第 i 镜", () => {
  assert.match(page, /按清单编号从前往后成镜/u, "这是校验器唯一强制的事，必须说出来");
  assert.match(page, /跳过的项不会留空镜头/u, "跳过后素材会往前顶，不能让用户以为槽位是固定的");
  assert.doesNotMatch(page, /第 1 项拍的素材会出现在第 1 个镜头/u, "跳过前面的项时这句话不成立");
});

test("重新生成清单的限制在页面上说明，而不是等服务报错才知道", () => {
  assert.match(page, /删掉正在用它的项目/u);
});

test("业务拒绝把服务端说的原因显示出来，不被通用套话盖住", () => {
  assert.match(page, /isInlineIssueAction\(issue\.action\) \|\| issue\.action === "none"/u);
  assert.match(page, /<small>\{issue\.userMessage\}<\/small>/u, "镜头太少或清单已绑定时，必须看见服务端那一句");
  assert.doesNotMatch(
    page,
    /\{issue \? <IssueNotice/u,
    "向导不能把 action=none 的拒绝丢给只展示套话的共享通知",
  );
});

test("脚注链接的触达高度不小于 44px，且不靠撑高整行来凑", () => {
  assert.match(css, /\.replica-wizard__link \{[^}]*min-height: 44px/u);
  assert.match(css, /\.replica-wizard__link \{[^}]*display: inline-flex/u);
  assert.match(css, /\.replica-wizard__link \{[^}]*margin-block: -12px/u, "负边距把加高的点击区收回行高里");
  assert.doesNotMatch(css, /\.replica-wizard__link \{[^}]*min-height: unset/u);
});
