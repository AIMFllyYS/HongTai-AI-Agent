import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type {
  AppTaskRecord,
  DiagnosisSessionRecord,
  StructuredGenerationProgressV1,
  TaskChangeEventV1,
  TaskIssue,
} from "../packages/core/src/index";

const webRoot = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

test("validated module presenters expose only explicit diagnosis and content-analysis fields", async () => {
  const diagnosis = await import("../apps/web/src/features/diagnosis/diagnosis-module-progress");
  const content = await import("../apps/web/src/features/tasks/content-analysis-module-progress");

  assert.deepEqual(diagnosis.diagnosisModuleDefinitions.map((item) => item.moduleId), [
    "visual-observations",
    "observation-summary",
    "wellness-recommendations",
    "safety-limitations",
    "follow-up-questions",
  ]);
  assert.deepEqual(content.contentAnalysisModuleDefinitions.map((item) => item.moduleId), [
    "overview",
    "hook-drivers",
    "structure-claims",
    "style-template",
    "risks-boundaries",
  ]);

  const visual = diagnosis.diagnosisModuleDefinitions[0]?.present({
    imageQuality: { usable: true, overallQuality: "good", limitations: [], retakeSuggestions: [] },
    observations: [{ region: "舌体", label: "可见颜色", description: "颜色较均匀" }],
    reasoning: "private reasoning",
    privateImageUri: "file:///private/observation.jpg",
  });
  const overview = content.contentAnalysisModuleDefinitions[0]?.present({
    overview: {
      summary: "围绕真实证据拆解",
      theme: "内容表达",
      targetAudiences: ["门店经营者"],
      communicationGoal: "提供参考",
      unapprovedField: "must stay hidden",
    },
    rawResponse: "raw model response",
  });

  assert.match(JSON.stringify(visual), /颜色较均匀/);
  assert.doesNotMatch(JSON.stringify(visual), /private reasoning|file:\/\/\/private/);
  assert.match(JSON.stringify(overview), /围绕真实证据拆解|门店经营者/);
  assert.doesNotMatch(JSON.stringify(overview), /must stay hidden|raw model response/);
});

test("validated module progress models repair and failure states without raw JSON", async () => {
  const [{ buildValidatedModuleRows }, { diagnosisModuleDefinitions }] = await Promise.all([
    import("../apps/web/src/features/generation/validated-module-progress"),
    import("../apps/web/src/features/diagnosis/diagnosis-module-progress"),
  ]);
  const progress: StructuredGenerationProgressV1 = {
    schemaVersion: "structured-generation-progress.v1",
    flow: "diagnosis-report",
    phase: "generating",
    modules: [
      {
        moduleId: "visual-observations",
        status: "succeeded",
        result: {
          imageQuality: { usable: true, overallQuality: "good", limitations: [], retakeSuggestions: [] },
          observations: [{ region: "舌体", label: "可见颜色", description: "颜色较均匀" }],
          reasoning: "must not render",
        },
      },
      { moduleId: "observation-summary", status: "repairing" },
      { moduleId: "wellness-recommendations", status: "pending" },
      { moduleId: "safety-limitations", status: "pending" },
      { moduleId: "follow-up-questions", status: "pending" },
    ],
  };
  const issue: TaskIssue = {
    code: "AI_FORMAT_REPAIR_FAILED",
    severity: "error",
    userMessage: "观察摘要结构未通过校验",
    retryable: false,
    action: "retry",
  };

  const repairing = buildValidatedModuleRows(diagnosisModuleDefinitions, progress);
  const failed = buildValidatedModuleRows(diagnosisModuleDefinitions, {
      ...progress,
      phase: "validating",
      modules: progress.modules.map((module) => module.moduleId === "observation-summary"
        ? { moduleId: module.moduleId, status: "failed" as const }
        : module),
    }, issue);

  assert.match(JSON.stringify(repairing), /颜色较均匀/);
  assert.match(JSON.stringify(repairing), /正在校正完整结构/);
  assert.match(JSON.stringify(repairing), /等待生成/);
  assert.doesNotMatch(JSON.stringify(repairing), /must not render|已接收\s*\d+\s*个字符/);
  assert.match(JSON.stringify(failed), /AI_FORMAT_REPAIR_FAILED/);
  assert.match(JSON.stringify(failed), /观察摘要结构未通过校验/);
  assert.match(JSON.stringify(failed), /未开始/);
});

test("task history replays upserts and deletes received while a stale list read is in flight", async () => {
  const [{ LiveListReadReconciler }, { applyTaskHistoryChange }] = await Promise.all([
    import("../apps/web/src/features/generation/live-list-read-reconciler"),
    import("../apps/web/src/pages/TaskHomePage"),
  ]);
  const staleTask = {
    id: "task-stale",
    status: "running",
    updatedAt: "2026-08-13T00:00:00.000Z",
  } as AppTaskRecord;
  const removedTask = {
    id: "task-removed",
    status: "succeeded",
    updatedAt: "2026-08-12T00:00:00.000Z",
  } as AppTaskRecord;
  const completedTask = {
    ...staleTask,
    status: "succeeded",
    updatedAt: "2026-08-13T00:01:00.000Z",
  } as AppTaskRecord;
  const reads = new LiveListReadReconciler<TaskChangeEventV1>();
  const read = reads.beginRead();

  reads.record({ schemaVersion: "task-change.v1", type: "upsert", task: completedTask });
  reads.record({ schemaVersion: "task-change.v1", type: "deleted", taskId: removedTask.id });
  const reconciled = reads.reconcile(
    read,
    [staleTask, removedTask] as readonly AppTaskRecord[],
    (current, event) => applyTaskHistoryChange(current, event),
  );

  assert.deepEqual(reconciled?.map((task) => [task.id, task.status]), [["task-stale", "succeeded"]]);
});

test("observation history replays a terminal session received before a stale list returns", async () => {
  const [{ LiveListReadReconciler }, { upsertObservationSession }] = await Promise.all([
    import("../apps/web/src/features/generation/live-list-read-reconciler"),
    import("../apps/web/src/pages/ObservationStartPage"),
  ]);
  const running = {
    sessionId: "session-race",
    mode: "tongue",
    image: { kind: "image", uri: "app-media://observation/session-race" },
    reportStatus: "running",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
  } as DiagnosisSessionRecord;
  const succeeded = {
    ...running,
    reportStatus: "succeeded",
    updatedAt: "2026-08-13T00:02:00.000Z",
  } as DiagnosisSessionRecord;
  const reads = new LiveListReadReconciler<DiagnosisSessionRecord>();
  const read = reads.beginRead();

  reads.record(succeeded);
  const reconciled = reads.reconcile(
    read,
    [running] as readonly DiagnosisSessionRecord[],
    (current, session) => upsertObservationSession(current, session),
  );

  assert.equal(reconciled?.[0]?.reportStatus, "succeeded");
  assert.equal(reconciled?.[0]?.updatedAt, succeeded.updatedAt);
});

test("an older list response cannot resolve after a newer read has started", async () => {
  const { LiveListReadReconciler } = await import("../apps/web/src/features/generation/live-list-read-reconciler");
  const reads = new LiveListReadReconciler<string>();
  const olderRead = reads.beginRead();
  const newerRead = reads.beginRead();

  assert.equal(reads.reconcile(olderRead, ["stale"], (current, event) => [...current, event]), undefined);
  reads.record("live");
  assert.deepEqual(reads.reconcile(newerRead, ["fresh"], (current, event) => [...current, event]), ["fresh", "live"]);
});

test("legacy raw-json stream preview residue is removed from runtime and web UI", () => {
  assert.equal(existsSync(join(webRoot, "components", "StructuredStreamProgress.tsx")), false);
  assert.equal(existsSync(join(process.cwd(), "packages", "capacitor-runtime", "src", "structured-stream-preview.ts")), false);
  assert.equal(existsSync(join(process.cwd(), "packages", "capacitor-runtime", "src", "structured-stream-preview.test.ts")), false);
  assert.doesNotMatch(read("styles/components.css"), /\.structured-stream-progress/);
  assert.equal(existsSync(join(webRoot, "components", "ValidatedModuleProgress.tsx")), true);
});

test("live generation pages use narrow subscriptions with no healthy-state manual refresh", () => {
  const home = read("pages/TaskHomePage.tsx");
  const taskPage = read("pages/TaskPage.tsx");
  const observationStart = read("pages/ObservationStartPage.tsx");
  const observationReport = read("pages/ObservationReportPage.tsx");
  const component = read("components/ValidatedModuleProgress.tsx");
  const css = read("styles/components.css");

  assert.match(home, /runtime\.tasks\.subscribeChanges/);
  assert.match(home, /LiveListReadReconciler<TaskChangeEventV1>/);
  assert.match(home, /taskHistoryReads\.current\.record\(event\)/);
  assert.match(home, /if \(reconciled === undefined\) return;/);
  assert.match(home, /runtime\.analysis\.importVideo\([^)]*event/);
  assert.match(taskPage, /runtime\.tasks\.subscribe/);
  assert.match(taskPage, /runtime\.tasks\.subscribeChanges/);
  assert.match(taskPage, /runtime\.analysis\.subscribe\(taskId/);
  assert.match(taskPage, /LiveListReadReconciler<TaskChangeEventV1>/);
  assert.match(taskPage, /if \(reconciled === undefined\) return;/);
  assert.match(observationStart, /runtime\.diagnosis\.subscribeReport/);
  assert.match(observationStart, /if \(subscriptions\.has\(sessionId\)\) continue/);
  assert.match(observationStart, /wantedIds\.has\(sessionId\)[\s\S]*subscriptions\.delete\(sessionId\)/);
  assert.doesNotMatch(observationStart, /return \(\) => subscriptions\.forEach\(\(unsubscribe\) => unsubscribe\(\)\)/);
  assert.match(observationStart, /LiveListReadReconciler<DiagnosisSessionRecord>/);
  assert.match(observationStart, /observationHistoryReads\.current\.record\(/);
  assert.match(observationStart, /if \(reconciled === undefined\) return;/);
  assert.match(observationStart, /event\.type === "failed"[\s\S]*runtime\.diagnosis\.getSession\(sessionId\)/);
  assert.match(observationReport, /runtime\.diagnosis\.subscribeReport\(sessionId/);
  assert.match(observationReport, /ObservationObservingScreen/);
  assert.match(observationReport, /record\?\.status === "succeeded" \|\| record\?\.status === "failed"/);
  assert.doesNotMatch(observationReport, /开始生成报告/);
  assert.doesNotMatch(observationReport, /ValidatedModuleProgress/);

  for (const source of [home, taskPage, observationStart, observationReport]) {
    assert.doesNotMatch(source, /setInterval|setTimeout|WebSocket/);
    assert.doesNotMatch(source, />刷新</);
    assert.doesNotMatch(source, /刷新本地详情|刷新本地结果/);
  }
  assert.doesNotMatch([home, taskPage, observationStart, observationReport, component].join("\n"), /StructuredStreamProgress|已接收\s*\d*\s*个字符/);
  assert.match(component, /aria-atomic="true" aria-live="polite"[\s\S]*role="status"/);
  assert.match(component, /没有完成，后续内容暂未开始/);
  assert.doesNotMatch(component, /<code>\{row\.issue\?\.code\}<\/code>/);
  assert.doesNotMatch(component, /JSON\.stringify/);
  assert.match(css, /validated-module-result-reveal[\s\S]*600ms/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.validated-module-progress__skeleton-bar[\s\S]*animation:\s*none/);
  assert.match(css, /@media\s*\(max-width:\s*26\.875rem\)[\s\S]*\.validated-module-progress/);
});

test("live generation renders runtime-only deep thinking and keeps busy primary actions green", () => {
  const component = read("components/ValidatedModuleProgress.tsx");
  const thinking = read("components/DeepThinkingPanel.tsx");
  const css = read("styles/components.css");
  const home = read("pages/TaskHomePage.tsx");
  const detail = read("pages/TaskDetailPage.tsx");
  const observationStart = read("pages/ObservationStartPage.tsx");
  const observationPanels = read("features/diagnosis/observation-start-panels.tsx");
  const followUpComposer = read("features/diagnosis/observation-follow-up-composer.tsx");

  assert.match(component, /DeepThinkingPanel/);
  assert.match(component, /progress\?\.thinking/);
  assert.match(thinking, /<details[\s\S]*深度思考[\s\S]*<pre/);
  assert.match(thinking, /thinking\.status === "streaming"[\s\S]*setOpen\(true\)/);
  assert.match(thinking, /thinking\.status === "completed"[\s\S]*setOpen\(false\)/);
  assert.match(thinking, /本次生成期间[\s\S]*不会保存|推理内容仅在本次生成期间显示/);
  assert.doesNotMatch(thinking, /dangerouslySetInnerHTML|localStorage|sessionStorage/);
  assert.match(css, /\.deep-thinking-panel/);
  assert.match(css, /\.validated-module-progress\s*\{[^}]*gap:\s*var\(--space-3\)/s);
  assert.match(css, /\.deep-thinking-panel\s*\{[^}]*overflow:\s*visible/s);
  assert.doesNotMatch(css, /\.deep-thinking-panel\s*\{[^}]*margin:\s*var\(--space-3\)\s+var\(--space-4\)\s+0/s);
  assert.doesNotMatch(css, /\.validated-module-progress\s*\{[^}]*gap:\s*0\s*;/s);
  assert.match(css, /\.button--primary\.is-busy:disabled[\s\S]*color:\s*var\(--color-text-on-primary\)[\s\S]*opacity:\s*1/);
  assert.match(observationPanels, /className=\{confirming \? "is-busy" : ""\}/);
  assert.match(detail, /className=\{pendingAction === "analysis" \? "is-busy" : ""\}/);
  assert.match(home, /className=\{videoImporting \? "is-busy" : ""\}/);
  assert.match(home, /<ValidatedModuleProgress/);
  assert.doesNotMatch(home, /taskAnalysisPath/);
  assert.match(followUpComposer, /pending \? "observation-follow-up-composer__send is-busy"/);
  assert.doesNotMatch([component, home, detail, observationStart, observationPanels].join("\n"), /正在生成五个板块|正在按顺序生成当前板块/);
});
