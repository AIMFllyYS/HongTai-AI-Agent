import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  defaultEditInputFocus,
  isInlineIssueAction,
  issueActionPresentation,
  issueDiagnosticSummary,
  issueTechnicalCode,
  issueTitle,
} from "../apps/web/src/components/IssueNotice";

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

  let focused = 0;
  const editInput = issueActionPresentation("edit_input", { editInput: () => { focused += 1; } });
  assert.equal(editInput.available, true);
  assert.equal(editInput.label, undefined);
  editInput.onAction?.();
  assert.equal(focused, 1);

  const missingEditInput = issueActionPresentation("edit_input");
  assert.equal(missingEditInput.available, false);
  assert.equal(missingEditInput.onAction, undefined);

  const source = read("components/IssueNotice.tsx");
  assert.match(source, /TaskIssueActionHandlers/);
  assert.match(source, /useNotification/);
  assert.match(source, /editInput\?:/);
  assert.doesNotMatch(source, /GlassCard/);
  assert.doesNotMatch(source, /issue\.code\s*===/);
});

test("edit_input stays inline and focuses the page-owned input without a top notice", () => {
  assert.equal(isInlineIssueAction("edit_input"), true);
  assert.equal(isInlineIssueAction("retry"), false);
  assert.equal(isInlineIssueAction("view_partial_result"), false);

  const source = read("components/IssueNotice.tsx");
  assert.match(source, /isInlineIssueAction\(issue\.action\)/);
  assert.match(source, /className=\{`issue-notice/);
  assert.match(source, /const \{ show, dismiss \} = useNotification\(\)/);
  assert.match(source, /if \(inline\) \{\s*dismiss\(\);/s);
  assert.match(source, /dismiss\(\);\s*\(actionsRef\.current\?\.editInput \?\? defaultEditInputFocus\)\(\);/s);
  assert.match(source, /return;\s*\n\s*\}/s);
  assert.match(source, /show\(/);
  assert.doesNotMatch(source, /issue\.code\s*===/);

  const focused: string[] = [];
  const previous = globalThis.document;
  (globalThis as { document?: { getElementById: (id: string) => { focus: () => void } | null } }).document = {
    getElementById(id) {
      return id === "task-share-input" ? { focus: () => { focused.push(id); } } : null;
    },
  };
  try {
    defaultEditInputFocus();
    assert.deepEqual(focused, ["task-share-input"]);
  } finally {
    if (previous === undefined) delete (globalThis as { document?: unknown }).document;
    else (globalThis as { document?: unknown }).document = previous;
  }
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

test("IssueNotice presents product language while keeping technical codes out of the visible notification", () => {
  assert.equal(issueTitle({ code: "AI_NETWORK_FAILED", userMessage: "文稿生成失败" }), "暂时无法连接 AI 服务");
  assert.equal(issueTitle({ code: "MEDIA_PROBE_FAILED", userMessage: "本地转写音频目标无效" }), "无法处理这个视频");
  assert.equal(issueTitle({ code: "PLATFORM_RISK_CONTROLLED", userMessage: "B站触发风控，暂时无法获取公开播放信息" }), "平台暂时限制了这次访问");
  assert.equal(issueTitle({ code: "PRODUCTION_PLAN_UNREADABLE", userMessage: "这份制作计划已经无法读取，项目和素材都还在。请重新生成计划，或删除这个项目。" }), "制作计划无法读取");

  const notice = read("components/IssueNotice.tsx");
  const top = read("components/TopNotification.tsx");
  assert.match(notice, /issueTitle\(issue\)/);
  assert.doesNotMatch(top, /technicalCode|top-notification__technical-code|data-technical-code/);
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
  assert.match(styles, /\.issue-notice small\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(styles, /\.issue-notice small\s*\{[^}]*white-space:\s*pre-line/s);
});

test("task, observation, and settings pages use the one IssueNotice action boundary", () => {
  const pages = [
    "pages/TaskHomePage.tsx",
    "pages/TaskPage.tsx",
    "pages/TaskProcessingPage.tsx",
    "pages/TaskDetailPage.tsx",
    "pages/TaskAnalysisPage.tsx",
    "pages/ObservationStartPage.tsx",
    "pages/ObservationReportPage.tsx",
    "pages/SettingsPage.tsx",
    "pages/ProfileSettingsPage.tsx",
    "pages/AiSettingsPage.tsx",
    "features/production/production-workbench-page.tsx",
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
  assert.match(read("pages/ObservationStartPage.tsx"), /selectMedia:/);
  assert.match(read("pages/ObservationReportPage.tsx"), /retry:/);
  assert.match(read("pages/AiSettingsPage.tsx"), /configureAi:/);
  assert.match(read("pages/ProfileSettingsPage.tsx"), /selectMedia:/);

  const home = read("pages/TaskHomePage.tsx");
  const create = `${read("pages/CreatePage.tsx")}\n${read("features/production/production-workbench-page.tsx")}`;
  const templates = read("pages/TemplatesPage.tsx");
  const observation = read("pages/ObservationReportPage.tsx");
  const processing = read("pages/TaskProcessingPage.tsx");
  const detail = read("pages/TaskDetailPage.tsx");
  const analysis = read("pages/TaskAnalysisPage.tsx");

  assert.match(home, /editInput:\s*focusTaskShareInput/);
  assert.match(create, /editInput:\s*focusProductionInput/);
  assert.match(templates, /editInput:\s*focusTemplateName/);
  assert.match(observation, /editInput:/);
  assert.match(observation, /setFollowUpOpen\(true\)/);
  assert.doesNotMatch(processing, /editInput:/);
  assert.doesNotMatch(detail, /editInput:/);
  assert.doesNotMatch(processing, />回首页</);
  assert.doesNotMatch(detail, />回首页</);

  assert.match(processing, /partialResult:/);
  assert.match(processing, /task\.media\.length > 0/);
  assert.match(processing, /task\.speechStatus/);
  assert.match(processing, /task\.status === "degraded"/);
  assert.match(processing, /task\.status === "succeeded"/);
  assert.match(processing, /onPartialResult/);
  assert.doesNotMatch(processing, /taskDetailPath\(task\.id\)/);
  assert.match(detail, /partialResult:/);
  assert.match(detail, /id="task-detail-media"/);
  assert.match(detail, /id="task-detail-transcript"/);
  assert.match(detail, /id="task-detail-image-text"/);
  assert.match(detail, /id="task-detail-summary"/);
  assert.match(detail, /scrollIntoView/);
  assert.match(analysis, /partialResult:/);
  assert.match(analysis, /detail\.evidenceUnits\.length > 0/);
  assert.match(analysis, /task-detail-summary/);
  assert.match(analysis, /scrollIntoView/);
  assert.doesNotMatch(analysis, /taskDetailPath\(taskId\)/);
  assert.doesNotMatch(home, /partialResult:/);
  assert.doesNotMatch(create, /partialResult:/);
  assert.doesNotMatch(templates, /partialResult:/);
  assert.doesNotMatch(observation, /partialResult:/);
  assert.doesNotMatch(read("pages/ObservationStartPage.tsx"), /partialResult:/);
  assert.doesNotMatch(read("pages/SettingsPage.tsx"), /partialResult:/);
  assert.doesNotMatch(read("pages/ProfileSettingsPage.tsx"), /partialResult:/);
  assert.doesNotMatch(read("pages/AiSettingsPage.tsx"), /partialResult:/);
});

test("publishing remains disabled while templates, observation and production use native runtimes", () => {
  for (const page of ["pages/PublishPage.tsx"]) {
    const source = read(page);
    assert.match(source, /disabled/);
    assert.doesNotMatch(source, /IssueNotice/);
    assert.doesNotMatch(source, /onClick=/);
  }

  const create = `${read("pages/CreatePage.tsx")}\n${read("features/production/production-workbench-page.tsx")}`;
  assert.match(create, /runtime\.production\.importAssets/);
  assert.match(create, /runtime\.production\.render/);
  assert.match(create, /IssueNotice/);

  const templates = read("pages/TemplatesPage.tsx");
  assert.match(templates, /runtime\.templates/);
  assert.match(templates, /IssueNotice/);

  const observation = read("pages/ObservationStartPage.tsx");
  assert.match(observation, /OBSERVATION_CAPTURE_IMAGE_SLOT/);
  assert.match(observation, /diagnosis\.captureImage/);
  assert.match(observation, /render:\s*true/);
  assert.match(observation, /runtime\.diagnosis\.captureImage/);
});
