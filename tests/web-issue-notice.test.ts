import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { issueActionPresentation } from "../apps/web/src/components/IssueNotice";

const webRoot = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

test("IssueNotice maps TaskIssue.action to explicit safe callbacks without branching on codes", () => {
  let retries = 0;
  const retry = issueActionPresentation("retry", { retry: () => { retries += 1; } });
  assert.equal(retry.available, true);
  assert.equal(retry.label, "重试");
  retry.onAction?.();
  assert.equal(retries, 1);

  const missingSelectMedia = issueActionPresentation("select_media");
  assert.equal(missingSelectMedia.available, false);
  assert.equal(missingSelectMedia.onAction, undefined);
  assert.match(missingSelectMedia.guidance, /重新选择/);

  const noOp = issueActionPresentation("free_storage", { retry: () => { retries += 1; } });
  assert.equal(noOp.available, false);
  assert.equal(noOp.onAction, undefined);
  assert.match(noOp.guidance, /释放/);

  const source = read("components/IssueNotice.tsx");
  assert.match(source, /TaskIssueActionHandlers/);
  assert.match(source, /data-issue-action-state/);
  assert.doesNotMatch(source, /issue\.code\s*===/);
});

test("task, observation, and settings pages use the one IssueNotice action boundary", () => {
  const pages = [
    "pages/TaskHomePage.tsx",
    "pages/TaskProcessingPage.tsx",
    "pages/TaskDetailPage.tsx",
    "pages/TaskAnalysisPage.tsx",
    "pages/ObservationStartPage.tsx",
    "pages/ObservationReportPage.tsx",
    "pages/SettingsPage.tsx",
    "pages/ProfileSettingsPage.tsx",
    "pages/AiSettingsPage.tsx",
  ];

  for (const page of pages) {
    const source = read(page);
    assert.match(source, /IssueNotice/, `${page} should use the shared issue presenter`);
    assert.doesNotMatch(source, /onAction=/, `${page} should not bypass action presentation`);
  }

  assert.doesNotMatch(read("pages/TaskProcessingPage.tsx"), /retry:\s*ingestAvailable && canRetry/);
  assert.doesNotMatch(read("pages/TaskProcessingPage.tsx"), /runtime\.tasks\.(cancel|retry)/);
  assert.doesNotMatch(read("pages/TaskDetailPage.tsx"), /runtime\.tasks\.retry/);
  assert.match(read("pages/TaskProcessingPage.tsx"), /configureAi:/);
  assert.doesNotMatch(read("pages/TaskProcessingPage.tsx"), /partialResult:/);
  assert.match(read("pages/ObservationStartPage.tsx"), /selectMedia:/);
  assert.match(read("pages/ObservationReportPage.tsx"), /retry:/);
  assert.match(read("pages/AiSettingsPage.tsx"), /configureAi:/);
  assert.match(read("pages/ProfileSettingsPage.tsx"), /selectMedia:/);
});

test("planned shells remain disabled while observation capture uses the native runtime", () => {
  for (const page of ["pages/CreatePage.tsx", "pages/AssetsPage.tsx", "pages/PublishPage.tsx"]) {
    const source = read(page);
    assert.match(source, /disabled/);
    assert.doesNotMatch(source, /IssueNotice/);
    assert.doesNotMatch(source, /onClick=/);
  }

  const observation = read("pages/ObservationStartPage.tsx");
  assert.match(observation, /OBSERVATION_CAPTURE_IMAGE_SLOT/);
  assert.match(observation, /diagnosis\.captureImage/);
  assert.match(observation, /render:\s*true/);
  assert.match(observation, /runtime\.diagnosis\.captureImage/);
});
