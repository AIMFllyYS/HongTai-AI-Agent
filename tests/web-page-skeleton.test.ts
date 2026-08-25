import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { pageSkeletonLayoutForPath } from "../apps/web/src/components/PageSkeleton";
import { remainingSkeletonHold } from "../apps/web/src/motion/skeleton-hold";

const webRoot = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

test("skeleton hold uses a shared minimum without inventing progress", () => {
  assert.equal(remainingSkeletonHold(1_000, 1_200, 400), 200);
  assert.equal(remainingSkeletonHold(1_000, 1_500, 400), 0);
  assert.equal(remainingSkeletonHold(null, 1_500, 400), 0);
  assert.match(read("motion/skeleton-hold.ts"), /motionDurations\.skeleton/);
  assert.match(read("motion/skeleton-hold.ts"), /RouteSkeletonTimingProvider/);
  assert.match(read("App.tsx"), /RouteSkeletonTimingProvider/);
  assert.doesNotMatch(read("App.tsx"), /holdLazyModule/);
});

test("route paths pick an honest skeleton layout without fake copy", () => {
  assert.equal(pageSkeletonLayoutForPath("/"), "home");
  assert.equal(pageSkeletonLayoutForPath("/observation/new"), "observation");
  assert.equal(pageSkeletonLayoutForPath("/templates"), "templates");
  assert.equal(pageSkeletonLayoutForPath("/settings/ai"), "settings");
  assert.equal(pageSkeletonLayoutForPath("/settings/storage"), "settings");
  assert.equal(pageSkeletonLayoutForPath("/tasks/abc"), "task");
  assert.equal(pageSkeletonLayoutForPath("/observation/sid"), "report");
  assert.equal(pageSkeletonLayoutForPath("/create/p1/edit"), "create");
  assert.equal(pageSkeletonLayoutForPath("/playbook"), "generic");

  const source = read("components/PageSkeleton.tsx");
  assert.doesNotMatch(source, /2\.4 万|128 MB|已是最新/);
  assert.match(source, /visually-hidden/);
  assert.match(source, /正在打开页面/);
});

test("product pages no longer render the fullscreen spinner loading panel", () => {
  const files = [
    "App.tsx",
    "components/StatePanels.tsx",
    "pages/TaskHomePage.tsx",
    "pages/TaskPage.tsx",
    "pages/ObservationStartPage.tsx",
    "pages/ObservationReportPage.tsx",
    "pages/CreatePage.tsx",
    "pages/ProductionEditPage.tsx",
    "pages/ReplicaWizardPage.tsx",
    "pages/TemplatesPage.tsx",
    "pages/SettingsPage.tsx",
    "pages/ProfileSettingsPage.tsx",
    "pages/AiSettingsPage.tsx",
    "pages/StorageAnalysisPage.tsx",
    "pages/ApplicationInfoPage.tsx",
    "pages/UpdateLogPage.tsx",
  ];
  for (const file of files) {
    assert.doesNotMatch(read(file), /LoadingState/, `${file} must not use LoadingState`);
  }
  assert.match(read("pages/TaskHomePage.tsx"), /layout="home-list"/);
  assert.equal((read("pages/TemplatesPage.tsx").match(/layout="templates-list"/g) ?? []).length, 2);
  assert.doesNotMatch(read("pages/TemplatesPage.tsx"), /\bLoadingState\b/);
  assert.match(read("styles/components.css"), /page-skeleton-shimmer/);
  assert.match(read("styles/components.css"), /prefers-reduced-motion:\s*reduce[\s\S]*\.page-skeleton__block[\s\S]*animation:\s*none/);
});
