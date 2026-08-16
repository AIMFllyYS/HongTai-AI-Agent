import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createStaticVisualDataAdapter } from "../apps/web/src/data/static-visual-adapter";
import * as router from "../apps/web/src/router";

const webRoot = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

const { appRoutes, matchRoute, pathForRoute, routeTransitionDirection } = router;

type DynamicRouteBuilders = {
  readonly taskProcessingPath: (taskId: string) => string;
  readonly taskDetailPath: (taskId: string) => string;
  readonly taskAnalysisPath: (taskId: string) => string;
  readonly profileSettingsPath: () => string;
  readonly aiSettingsPath: () => string;
  readonly appInfoSettingsPath: () => string;
  readonly observationNewPath: () => string;
  readonly observationReportPath: (sessionId: string) => string;
};

const dynamicRouteBuilders = router as typeof router & DynamicRouteBuilders;

test("web application routes expose canonical runtime paths", () => {
  const expectedPaths = [
    "/",
    "/tasks/:taskId/processing",
    "/tasks/:taskId",
    "/tasks/:taskId/analysis",
    "/create",
    "/templates",
    "/settings",
    "/settings/profile",
    "/settings/ai",
    "/settings/app-info",
    "/observation/new",
    "/observation/:sessionId",
  ];

  assert.deepEqual(
    appRoutes.map((route) => route.path),
    expectedPaths,
  );

  assert.equal(pathForRoute("home"), "/");
  assert.equal(pathForRoute("observation-new"), "/observation/new");
  assert.equal(pathForRoute("templates"), "/templates");
  assert.equal(matchRoute("/assets").key, "templates");
  assert.equal(matchRoute("/unknown").key, "not-found");
  assert.equal(matchRoute("/publish").key, "not-found");
  assert.doesNotMatch(read("router.ts"), /path:\s*"\/publish"/);
  assert.doesNotMatch(read("router.ts"), /\|\s*"publish"/);
});

test("dynamic task routes decode their identifiers and keep analysis as a distinct route", () => {
  const processing = matchRoute("/tasks/task-42/processing/");
  assert.equal(processing.key, "task-processing");
  assert.deepEqual(processing.params, { taskId: "task-42" });

  const detail = matchRoute("/tasks/task-42");
  assert.equal(detail.key, "task-detail");
  assert.deepEqual(detail.params, { taskId: "task-42" });

  const analysis = matchRoute("/tasks/task-42/analysis");
  assert.equal(analysis.key, "task-analysis");
  assert.deepEqual(analysis.params, { taskId: "task-42" });
});

test("route builders encode opaque task and observation identifiers", () => {
  assert.equal(typeof dynamicRouteBuilders.taskProcessingPath, "function");
  assert.equal(typeof dynamicRouteBuilders.taskDetailPath, "function");
  assert.equal(typeof dynamicRouteBuilders.taskAnalysisPath, "function");
  assert.equal(typeof dynamicRouteBuilders.observationReportPath, "function");

  const taskId = "retry/任务 42";
  const sessionId = "face/会话 7";
  assert.equal(dynamicRouteBuilders.taskProcessingPath(taskId), "/tasks/retry%2F%E4%BB%BB%E5%8A%A1%2042/processing");
  assert.equal(dynamicRouteBuilders.taskDetailPath(taskId), "/tasks/retry%2F%E4%BB%BB%E5%8A%A1%2042");
  assert.equal(dynamicRouteBuilders.taskAnalysisPath(taskId), "/tasks/retry%2F%E4%BB%BB%E5%8A%A1%2042/analysis");
  assert.equal(dynamicRouteBuilders.profileSettingsPath(), "/settings/profile");
  assert.equal(dynamicRouteBuilders.aiSettingsPath(), "/settings/ai");
  assert.equal(dynamicRouteBuilders.appInfoSettingsPath(), "/settings/app-info");
  assert.equal(dynamicRouteBuilders.observationNewPath(), "/observation/new");
  assert.equal(dynamicRouteBuilders.observationReportPath(sessionId), "/observation/face%2F%E4%BC%9A%E8%AF%9D%207");

  const roundTrip = matchRoute(dynamicRouteBuilders.taskDetailPath(taskId));
  assert.deepEqual(roundTrip.params, { taskId });
});

test("legacy vitality scan maps to the safe observation start and old analyze success paths do not resolve", () => {
  assert.equal(matchRoute("/vitality/scan").key, "observation-new");
  assert.match(read("router.ts"), /"\/vitality\/scan":\s*\{\s*key:\s*"observation-new"/);
  assert.doesNotMatch(read("router.ts"), /LegacyRouteKey/);
  assert.doesNotMatch(read("App.tsx"), /renderedRoute\.key === "(?:processing|analysis-result|video-detail|gallery-detail)"/);
  for (const legacyPath of [
    "/analyze/processing",
    "/analyze/result",
    "/analyze/detail/video",
    "/analyze/detail/gallery",
    "/vitality/result",
  ]) {
    assert.equal(matchRoute(legacyPath).key, "not-found", legacyPath);
  }
  for (const page of ["pages/ProcessingPage.tsx", "pages/AnalysisResultPage.tsx", "pages/DetailPage.tsx", "pages/VitalityScanPage.tsx", "pages/VitalityResultPage.tsx"]) {
    assert.equal(existsSync(join(webRoot, page)), false, `${page} should be removed`);
  }
});

test("route transition direction follows dynamic task route order", () => {
  assert.equal(routeTransitionDirection("/tasks/task-42/processing", "/tasks/task-42"), "forward");
  assert.equal(routeTransitionDirection("/tasks/task-42/analysis", "/tasks/task-42"), "backward");
  assert.equal(routeTransitionDirection("/observation/new", "/observation/session-42"), "forward");
});

test("static visual data is isolated behind the adapter boundary", () => {
  const adapter = createStaticVisualDataAdapter();
  const home = adapter.getHome();
  const processing = adapter.getProcessing();
  const videoDetail = adapter.getDetail("video");
  const galleryDetail = adapter.getDetail("gallery");

  assert.equal(adapter.source, "design-fixture");
  assert.ok(home.recent.length > 0);
  assert.ok(processing.steps.length > 0);
  assert.equal(videoDetail.variant, "video");
  assert.equal(galleryDetail.variant, "gallery");
  assert.ok(adapter.getCreate().templates.length > 0);
  assert.ok(adapter.getAssets().assets.length > 0);
  assert.ok(adapter.getSettings().modelRows.length > 0);
  assert.ok(adapter.getPublish().platforms.length > 0);
  assert.ok(adapter.getVitalityScan().advice.length > 0);
  assert.ok(adapter.getVitalityResult().faceObservations.length > 0);
});
