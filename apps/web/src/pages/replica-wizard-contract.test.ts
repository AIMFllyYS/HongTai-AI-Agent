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

test("向导有自己的路由，任务标识编码后进入路径，且不吃掉任务详情", () => {
  assert.equal(replicaWizardPath("task-1"), "/replica/task-1");
  assert.equal(replicaWizardPath("a/b?c"), "/replica/a%2Fb%3Fc");

  const matched = matchRoute("/replica/task-1");
  assert.equal(matched.key, "replica-wizard");
  assert.deepEqual(matched.params, { taskId: "task-1" });
  assert.equal(matchRoute(taskDetailPath("task-1")).key, "task-detail");
});

test("向导逐项绑定，不打开批量选择器", () => {
  assert.match(page, /importAssets\(project\.projectId, \{ requirementOrder: order \}\)/u, "每次导入都要说明这是哪一项的素材");
  assert.doesNotMatch(page, /importAssets\((?!project\.projectId, \{ requirementOrder)/u, "向导里不能出现不带清单项的导入");
});

test("向导不借用制作页的重试映射，也不自己合成成片", () => {
  assert.doesNotMatch(page, /resolveProductionRetryOperation|resolveProductionRetryKind/u, "制作页的 retry 会直接开始合成或重新规划");
  assert.doesNotMatch(page, /production\.render/u, "向导只负责准备素材和生成计划，导出在别处");
});

test("绑定关系只从素材读，向导不另存一份自己的完成状态", () => {
  assert.match(view, /asset\.requirementOrder === undefined \? \[\] : \[\[asset\.requirementOrder, asset\]/u);
  assert.doesNotMatch(page, /useState<[^>]*Record<number/u, "页面不能再存一份“哪项已完成”，否则删素材后会对不上");
});

test("素材齐了以后进微调页，而不是假装已经出片", () => {
  assert.match(page, /generatePlan\(project\.projectId\)/u);
  assert.match(page, /navigate\(productionEditPath\(ready\.projectId\)\)/u);
  assert.match(page, /再回制作页合成成片/u, "要说清这一步只出脚本和字幕，成片还没做");
});

test("清单项的脚本草稿被标成参考，不承诺就是最终口播", () => {
  assert.match(card, /最终口播会按你真正绑定的素材重写/u);
});

test("清单只说该拍什么，页面不声称它看懂了画面里有什么", () => {
  assert.match(page, /不代表画面里真的有这些内容/u);
  assert.match(page, /镜头顺序就是清单顺序/u, "顺序保证是这一页唯一敢承诺的事，必须说出来");
});

test("重新生成清单的限制在页面上说明，而不是等服务报错才知道", () => {
  assert.match(page, /删掉正在用它的项目/u);
});
