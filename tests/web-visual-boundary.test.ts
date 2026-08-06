import assert from "node:assert/strict";
import { test } from "node:test";

import { createStaticVisualDataAdapter } from "../apps/web/src/data/static-visual-adapter";
import { appRoutes, matchRoute, pathForRoute } from "../apps/web/src/router";

test("web visual routes stay explicit and discoverable", () => {
  const expectedPaths = [
    "/",
    "/analyze/processing",
    "/analyze/result",
    "/analyze/detail/video",
    "/analyze/detail/gallery",
    "/create",
    "/publish",
    "/assets",
    "/settings",
    "/vitality/scan",
    "/vitality/result",
  ];

  assert.deepEqual(
    appRoutes.map((route) => route.path),
    expectedPaths,
  );

  for (const path of expectedPaths) {
    assert.equal(matchRoute(`${path}/`).path, path);
  }

  assert.equal(pathForRoute("home"), "/");
  assert.equal(pathForRoute("vitality-result"), "/vitality/result");
  assert.equal(matchRoute("/unknown").key, "not-found");
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
