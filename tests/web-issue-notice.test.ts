import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { issueActionPresentation, issueDiagnosticSummary, issueTechnicalCode } from "../apps/web/src/components/IssueNotice";

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
  assert.match(source, /useNotification/);
  assert.match(source, /return null/);
  assert.doesNotMatch(source, /GlassCard/);
  assert.doesNotMatch(source, /issue\.code\s*===/);
});

test("IssueNotice combines the stable application code with a safe native code", () => {
  assert.equal(issueTechnicalCode({ code: "STORAGE_WRITE_FAILED" }), "STORAGE_WRITE_FAILED");
  assert.equal(
    issueTechnicalCode({ code: "AI_NETWORK_FAILED", details: { nativeCode: "ERR_AI_NETWORK_FAILED" } }),
    "AI_NETWORK_FAILED · ERR_AI_NETWORK_FAILED",
  );
  assert.equal(
    issueTechnicalCode({ code: "AI_NETWORK_FAILED", details: { nativeCode: "not-safe" } }),
    "AI_NETWORK_FAILED",
  );
});

test("IssueNotice formats only allowlisted native link diagnostics", () => {
  const summary = issueDiagnosticSummary({
    stage: "resolve-link",
    diagnostic: {
      schemaVersion: "native-link-diagnostic.v1",
      operation: "fetch-text",
      phase: "response",
      hostname: "www.douyin.com",
      errorClass: "timeout",
      elapsedMs: 1_234,
      networkType: "wifi",
      attempt: 2,
      redirectCount: 1,
    },
  });

  assert.equal(
    summary,
    "操作：抓取页面 · 任务阶段：解析链接 · 原生阶段：读取响应 · 主机：www.douyin.com · 错误：超时 · 耗时：1234ms · 网络：Wi-Fi · 尝试：2 · 跳转：1",
  );
});

test("IssueNotice diagnostic summary never renders query Cookie or Throwable text", () => {
  const summary = issueDiagnosticSummary({
    stage: "resolve-link",
    diagnostic: {
      schemaVersion: "native-link-diagnostic.v1",
      operation: "fetch-text",
      phase: "connect",
      hostname: "www.douyin.com?token=query-secret",
      errorClass: "tls",
      elapsedMs: 88,
      attempt: 1,
      redirectCount: 0,
      url: "https://www.douyin.com/video/1?token=query-secret",
      Cookie: "session-secret",
      throwableMessage: "SSLHandshakeException certificate raw-text",
    } as never,
  });

  assert.equal(summary, "操作：抓取页面 · 任务阶段：解析链接 · 原生阶段：建立连接 · 错误：TLS · 耗时：88ms · 尝试：1 · 跳转：0");
  assert.doesNotMatch(summary ?? "", /query-secret|session-secret|Cookie|SSLHandshakeException|raw-text|token=/);
});

test("IssueNotice diagnostic copy wraps on desktop and about 390px instead of hiding safe fields", () => {
  const source = read("components/IssueNotice.tsx");
  const styles = read("styles/components.css");

  assert.match(source, /issueDiagnosticSummary\(issue\)/);
  assert.match(styles, /\.top-notification__copy small\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(styles, /\.top-notification__copy small\s*\{[^}]*white-space:\s*pre-line/s);
  assert.doesNotMatch(styles, /\.top-notification__copy small\s*\{[^}]*text-overflow:\s*ellipsis/s);
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
    "pages/CreatePage.tsx",
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

test("planned shells remain disabled while observation and production use native runtimes", () => {
  for (const page of ["pages/AssetsPage.tsx", "pages/PublishPage.tsx"]) {
    const source = read(page);
    assert.match(source, /disabled/);
    assert.doesNotMatch(source, /IssueNotice/);
    assert.doesNotMatch(source, /onClick=/);
  }

  const create = read("pages/CreatePage.tsx");
  assert.match(create, /runtime\.production\.importAssets/);
  assert.match(create, /runtime\.production\.render/);
  assert.match(create, /IssueNotice/);

  const observation = read("pages/ObservationStartPage.tsx");
  assert.match(observation, /OBSERVATION_CAPTURE_IMAGE_SLOT/);
  assert.match(observation, /diagnosis\.captureImage/);
  assert.match(observation, /render:\s*true/);
  assert.match(observation, /runtime\.diagnosis\.captureImage/);
});
