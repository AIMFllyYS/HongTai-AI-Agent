import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { matchRoute, storageAnalysisPath, storageAreaPath } from "../apps/web/src/router";

const webRoot = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

const storage = read("pages/StorageAnalysisPage.tsx");
const area = read("pages/StorageAreaPage.tsx");
const css = read("styles/pages/settings.css");

test("storage management home renders the device overview card and the six-area distribution", () => {
  assert.match(storage, /title="存储管理"/);
  assert.match(storage, /本应用占用/);
  assert.match(storage, /analysis\.device\.totalByteLength/);
  assert.match(storage, /设备总容量/);
  assert.match(storage, /占用分布/);
  for (const label of ["拆解任务", "舌诊面诊", "制作项目", "模板数据", "缓存与临时文件", "应用配置"]) {
    assert.match(storage, new RegExp(label), label);
  }
  for (const areaName of ["tasks", "observations", "productions", "templates", "cache", "app-data"]) {
    assert.match(css, new RegExp(`storage-legend-dot--${areaName}`), `legend color for ${areaName}`);
  }
});

test("cache opens the shared actions sheet and clears through runtime.storage.clearCache", () => {
  assert.match(storage, /<TaskMoreActionsSheet/);
  assert.match(storage, /清除缓存/);
  assert.match(storage, /runtime\.storage\.clearCache\(\)/);
  assert.match(storage, /if \(busy\) return/);
  assert.match(storage, /code: "STORAGE_WRITE_FAILED"[\s\S]{0,120}action: "retry"/);
});

test("app-data opens a read-only composition sheet with grouped sizes and a real report export", () => {
  assert.match(storage, /title="应用配置"/);
  assert.match(storage, /系统与配置文件用于应用运行，无法清理/);
  assert.match(storage, /appDataGroups\.map/);
  assert.match(storage, /appDataGroupLabelFor/);
  assert.match(storage, /runtime\.storage\.exportReport\(\)/);
  assert.match(storage, /报告已生成/);
  assert.doesNotMatch(storage, /listAreaItems\("app-data"\)/, "app-data must not be listed per item");
});

test("drillable areas navigate to the area detail route", () => {
  assert.match(storage, /navigate\(storageAreaPath\(area\)\)/);
  assert.match(storage, /DRILLABLE_AREAS[^\n]*tasks[^\n]*observations[^\n]*productions[^\n]*templates/s);
  assert.equal(storageAreaPath("tasks"), "/settings/storage/tasks");
  assert.equal(matchRoute(storageAreaPath("templates")).key, "settings-storage-area");
  assert.equal(matchRoute(storageAnalysisPath()).key, "settings-storage");
});

test("the area page loads per-area listings, groups observations, and confirms deletion once", () => {
  assert.match(area, /runtime\.storage\.listAreaItems\(area\)/);
  assert.match(area, /item\.group === "tongue"/);
  assert.match(area, /item\.group === "face"/);
  assert.match(area, /舌诊/);
  assert.match(area, /面诊/);
  assert.match(area, /其他/);
  assert.match(area, /<ConfirmDeleteSheet/);
  assert.match(area, /应用私有目录\//, "delete confirmation shows the sanitized relative location");
  assert.match(area, /runtime\.storage\.deleteItem\(selectedItem\.id\)/);
  assert.match(area, /<EmptyState/);
  assert.match(area, /<ErrorState/);
  assert.doesNotMatch(area, /storage-delete-confirm/);
});

test("the area page refreshes the listing after deletion and reloads on a stale listing handle", () => {
  const confirmDelete = area.match(/const confirmDelete = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(confirmDelete, "confirmDelete should be present");
  assert.match(confirmDelete, /await runtime\.storage\.deleteItem/);
  assert.equal((confirmDelete.match(/listAreaItems/g) ?? []).length, 2, "reload after success and after a stale handle");
  assert.match(confirmDelete, /nextIssue\.code === "STORAGE_READ_FAILED"/, "stale listing handle branches on the stable code");
});
