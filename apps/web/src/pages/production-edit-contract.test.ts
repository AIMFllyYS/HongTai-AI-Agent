import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { matchRoute, pathForRoute, productionEditPath } from "../router";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

const page = read("pages/ProductionEditPage.tsx");
const workbench = read("features/production/production-workbench-page.tsx");

test("旧微调路由保留为兼容重定向，项目标识始终编码后进入路径", () => {
  assert.equal(productionEditPath("project-1"), "/create/project-1/edit");
  assert.equal(productionEditPath("a/b?c"), "/create/a%2Fb%3Fc/edit");

  const matched = matchRoute("/create/project-1/edit");
  assert.equal(matched.key, "production-edit");
  assert.deepEqual(matched.params, { projectId: "project-1" });
  assert.equal(matchRoute("/create").key, "create", "微调路由不能吃掉制作首页");
  assert.equal(pathForRoute("create"), "/create");
});

test("重定向把项目带回制作页并定位，项目不存在也不留死状态", () => {
  assert.match(page, /navigate\(`\$\{pathForRoute\("create"\)\}\?project=\$\{encodeURIComponent\(projectId\)\}`\)/u,
    "重定向必须携带 project 参数，让制作页选中该项目");
  assert.match(page, /runtime\.production\.get\(projectId\)\.catch\(\(\) => undefined\)/u,
    "项目读取失败也要完成重定向，把空态交给制作页如实呈现");
  assert.doesNotMatch(page, /applyFetched|setConflict|planDraftProblem|previewShot/u,
    "旧微调页的草稿编辑逻辑不得回流到重定向壳里");
  assert.match(workbench, /consumeProjectParamFromSearch/u, "制作页要消费 ?project= 参数选中项目");
  assert.match(workbench, /params\.delete\("project"\)/u, "消费后从地址栏清除，避免刷新反复触发");
});
