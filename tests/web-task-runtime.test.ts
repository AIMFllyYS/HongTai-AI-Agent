import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { AppTaskRecord, ContentAnalysisRecord, TaskEventRecord } from "../packages/core/src/index";

const webRoot = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

interface TaskPresenters {
  readonly TASK_STAGE_ORDER: readonly string[];
  buildTaskStagePresentations(task: AppTaskRecord, events: readonly TaskEventRecord[]): readonly {
    readonly stage: string;
    readonly status: string;
    readonly statusLabel: string;
    readonly detail?: string;
    readonly progress?: number;
    readonly sequence?: number;
  }[];
  readContentAnalysis(record: ContentAnalysisRecord): {
    readonly available: boolean;
    readonly overview?: { readonly summary: string; readonly theme: string };
    readonly hook?: { readonly description: string; readonly evidenceRefs: readonly string[] };
    readonly structure: readonly { readonly order: number; readonly summary: string; readonly evidenceRefs: readonly string[] }[];
  };
}

interface TaskHomeSubject {
  submitLocalTask(
    tasks: {
      create(input: { readonly input: string }): Promise<AppTaskRecord>;
      start(taskId: string): Promise<unknown>;
    },
    input: string,
  ): Promise<
    | { readonly status: "started"; readonly task: AppTaskRecord }
    | { readonly status: "create_failed"; readonly issue: { readonly code: string } }
    | { readonly status: "start_failed"; readonly task: AppTaskRecord; readonly issue: { readonly code: string } }
  >;
}

async function presenters(): Promise<Partial<TaskPresenters>> {
  try {
    return await import("../apps/web/src/features/tasks/task-presenters") as TaskPresenters;
  } catch {
    return {};
  }
}

async function taskHomeSubject(): Promise<Partial<TaskHomeSubject>> {
  try {
    return await import("../apps/web/src/pages/TaskHomePage") as unknown as TaskHomeSubject;
  } catch {
    return {};
  }
}

test("task submission separates create and start failures without losing a queued task", async () => {
  const subject = await taskHomeSubject();
  assert.equal(typeof subject.submitLocalTask, "function");
  let starts = 0;
  const createFailure = await subject.submitLocalTask?.({
    create: async () => { throw new Error("write failed"); },
    start: async () => { starts += 1; },
  }, "https://v.douyin.com/demo/");
  assert.deepEqual(createFailure, {
    status: "create_failed",
    issue: {
      code: "STORAGE_WRITE_FAILED",
      severity: "error",
      userMessage: "无法保存本地采集任务",
      retryable: false,
      action: "free_storage",
      details: { cause: "Error" },
    },
  });
  assert.equal(starts, 0);

  const queued = { id: "task-queued" } as AppTaskRecord;
  const startFailure = await subject.submitLocalTask?.({
    create: async () => queued,
    start: async () => { throw new Error("start failed"); },
  }, "https://v.douyin.com/demo/");
  assert.equal(startFailure?.status, "start_failed");
  assert.equal(startFailure && "task" in startFailure ? startFailure.task : undefined, queued);
  assert.equal(startFailure && "issue" in startFailure ? startFailure.issue.code : undefined, "INTERNAL_UNKNOWN_ERROR");
});

test("task UI presents only the persisted seven stages in monotonic event order", async () => {
  const subject = await presenters();
  assert.equal(typeof subject.buildTaskStagePresentations, "function");
  assert.deepEqual(subject.TASK_STAGE_ORDER, [
    "detect-platform",
    "resolve-link",
    "parse-content",
    "select-media",
    "download-media",
    "obtain-transcript",
    "save-artifacts",
  ]);

  const task = {
    id: "task-7",
    sourceUrl: "https://www.bilibili.com/video/BV1xx",
    status: "running",
    currentStage: "download-media",
    analysisStatus: "not_started",
    media: [],
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:01:00.000Z",
    issues: [],
  } as AppTaskRecord;
  const events = [
    { taskId: "task-7", sequence: 2, stage: "resolve-link", status: "running", message: "正在处理跳转", timestamp: "2026-08-07T00:00:02.000Z" },
    { taskId: "task-7", sequence: 4, stage: "download-media", status: "running", message: "正在下载", progress: 0.47, timestamp: "2026-08-07T00:00:04.000Z" },
    { taskId: "task-7", sequence: 3, stage: "resolve-link", status: "succeeded", message: "已获得最终链接", timestamp: "2026-08-07T00:00:03.000Z" },
  ] as const satisfies readonly TaskEventRecord[];

  const steps = subject.buildTaskStagePresentations?.(task, events);
  assert.equal(steps?.length, 7);
  assert.deepEqual(steps?.map((step) => step.stage), subject.TASK_STAGE_ORDER);
  assert.equal(steps?.[1]?.status, "succeeded");
  assert.equal(steps?.[1]?.detail, "已获得最终链接");
  assert.equal(steps?.[1]?.sequence, 3);
  assert.equal(steps?.[4]?.status, "running");
  assert.equal(steps?.[4]?.detail, "正在下载");
  assert.equal(steps?.[4]?.progress, 47);
  assert.equal(steps?.[4]?.sequence, 4);
  assert.equal(steps?.[5]?.status, "pending");
  assert.equal(steps?.[5]?.statusLabel, "等待中");
});

test("终态任务缺阶段事件时不渲染等待中且不推断已完成", async () => {
  const subject = await presenters();
  assert.equal(typeof subject.buildTaskStagePresentations, "function");

  const degradedTask = {
    id: "task-degraded",
    sourceUrl: "https://www.douyin.com/note/1",
    status: "degraded",
    currentStage: "save-artifacts",
    analysisStatus: "not_started",
    media: [],
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:01:00.000Z",
    issues: [],
  } as AppTaskRecord;
  const degradedEvents = [
    { taskId: "task-degraded", sequence: 1, stage: "detect-platform", status: "succeeded", message: "完成", timestamp: "2026-08-16T00:00:01.000Z" },
    { taskId: "task-degraded", sequence: 2, stage: "resolve-link", status: "succeeded", message: "完成", timestamp: "2026-08-16T00:00:02.000Z" },
    { taskId: "task-degraded", sequence: 3, stage: "parse-content", status: "succeeded", message: "完成", timestamp: "2026-08-16T00:00:03.000Z" },
    { taskId: "task-degraded", sequence: 4, stage: "select-media", status: "degraded", message: "没有视频源", timestamp: "2026-08-16T00:00:04.000Z" },
    { taskId: "task-degraded", sequence: 5, stage: "save-artifacts", status: "succeeded", message: "完成", timestamp: "2026-08-16T00:00:05.000Z" },
  ] as const satisfies readonly TaskEventRecord[];

  const degradedSteps = subject.buildTaskStagePresentations?.(degradedTask, degradedEvents);
  assert.equal(degradedSteps?.[3]?.status, "degraded");
  assert.equal(degradedSteps?.[4]?.status, "degraded");
  assert.notEqual(degradedSteps?.[4]?.status, "succeeded");
  assert.notEqual(degradedSteps?.[4]?.statusLabel, "等待中");
  assert.equal(degradedSteps?.[5]?.status, "degraded");
  assert.notEqual(degradedSteps?.[5]?.status, "succeeded");
  assert.notEqual(degradedSteps?.[5]?.statusLabel, "等待中");
  assert.equal(degradedSteps?.[6]?.status, "succeeded");

  const failedTask = {
    ...degradedTask,
    id: "task-failed",
    status: "failed",
    currentStage: "resolve-link",
  } as AppTaskRecord;
  const failedEvents = [
    { taskId: "task-failed", sequence: 1, stage: "detect-platform", status: "succeeded", message: "完成", timestamp: "2026-08-16T00:00:01.000Z" },
    { taskId: "task-failed", sequence: 2, stage: "resolve-link", status: "failed", message: "失败", timestamp: "2026-08-16T00:00:02.000Z" },
  ] as const satisfies readonly TaskEventRecord[];

  const failedSteps = subject.buildTaskStagePresentations?.(failedTask, failedEvents);
  assert.equal(failedSteps?.[1]?.status, "failed");
  for (const step of failedSteps?.slice(2) ?? []) {
    assert.notEqual(step.status, "pending");
    assert.notEqual(step.status, "succeeded");
    assert.notEqual(step.statusLabel, "等待中");
  }
});

test("content-analysis presenter renders only validated content-analysis.v1 fields and evidence references", async () => {
  const subject = await presenters();
  assert.equal(typeof subject.readContentAnalysis, "function");

  const record = {
    taskId: "task-7",
    status: "succeeded",
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:02:00.000Z",
    result: {
      schemaVersion: "content-analysis.v1",
      document: {
        overview: { summary: "以真实证据拆解内容结构", theme: "门店服务" },
        hook: { description: "先提出顾客问题", evidenceRefs: ["segment-1"] },
        structure: [{ order: 1, summary: "问题引入", evidenceRefs: ["segment-1"] }],
      },
    },
  } as ContentAnalysisRecord;

  const view = subject.readContentAnalysis?.(record);
  assert.equal(view?.available, true);
  assert.deepEqual(view?.overview, { summary: "以真实证据拆解内容结构", theme: "门店服务", targetAudiences: [] });
  assert.deepEqual(view?.hook, { description: "先提出顾客问题", evidenceRefs: ["segment-1"] });
  assert.equal(view?.structure[0]?.order, 1);
  assert.equal(view?.structure[0]?.summary, "问题引入");
  assert.deepEqual(view?.structure[0]?.evidenceRefs, ["segment-1"]);

  const invalid = subject.readContentAnalysis?.({ ...record, result: { schemaVersion: "other.v1", document: {} } });
  assert.equal(invalid?.available, false);
});

test("runtime task pages are wired to AppRuntime and static fixtures remain outside the live routes", () => {
  for (const relativePath of [
    "pages/TaskHomePage.tsx",
    "pages/TaskPage.tsx",
    "pages/TaskProcessingPage.tsx",
    "pages/TaskDetailPage.tsx",
    "pages/TaskAnalysisPage.tsx",
  ]) {
    assert.equal(existsSync(join(webRoot, relativePath)), true, `${relativePath} should exist`);
    assert.doesNotMatch(read(relativePath), /data\/fixtures/);
  }

  const app = read("App.tsx");
  for (const component of ["TaskHomePage", "TaskPage"]) {
    assert.match(app, new RegExp(component));
  }
  assert.doesNotMatch(app, /<TaskProcessingPage|<TaskDetailPage|<TaskAnalysisPage/);
  assert.match(read("pages/TaskHomePage.tsx"), /runtime\.tasks\.inspectInput/);
  assert.match(read("pages/TaskHomePage.tsx"), /submitLocalTask\(runtime\.tasks/);
  assert.match(read("pages/TaskHomePage.tsx"), /runtime\.analysis\.importVideo\(/);
  assert.match(read("features/tasks/TaskHistory.tsx"), /sourceKind === "local_video"/);
  assert.match(read("pages/TaskPage.tsx"), /runtime\.tasks\.subscribe/);
  assert.match(read("pages/TaskPage.tsx"), /runtime\.tasks\.listEvents/);
  assert.match(read("pages/TaskPage.tsx"), /runtime\.tasks\.getDetail/);
  assert.match(read("pages/TaskPage.tsx"), /runtime\.analysis\.get/);
  assert.match(read("pages/TaskDetailPage.tsx"), /runtime\.analysis\.run/);
  assert.match(read("pages/TaskDetailPage.tsx"), /runtime\.tasks\.delete\(/);
});

test("every live task page re-reads its safe persisted DTOs after app resume", () => {
  const pages = new Map([
    ["pages/TaskHomePage.tsx", "loadHistory"],
    ["pages/TaskPage.tsx", "load"],
  ]);
  for (const [relativePath, loader] of pages) {
    const source = read(relativePath);
    assert.match(source, /from "\.\.\/hooks\/useAppResume"/);
    assert.match(source, new RegExp(`useAppResume\\(${loader}\\)`));
    assert.doesNotMatch(source, /@capacitor\/app/);
  }
});

test("task pages keep real events but never offer stop or lineage-retry controls", () => {
  const home = read("pages/TaskHomePage.tsx");
  const page = read("pages/TaskPage.tsx");
  const processing = read("pages/TaskProcessingPage.tsx");
  const detail = read("pages/TaskDetailPage.tsx");

  assert.match(home, /runtime\.tasks\.inspectInput/);
  assert.match(home, /runtime\.tasks\.list/);
  assert.match(home, /disabled=\{!ingestAvailable \|\| !inspection\?\.ok \|\| submitting \|\| videoImporting\}/);
  assert.doesNotMatch(home, /if \(!ingestAvailable\) return/);
  assert.doesNotMatch(processing, /if \(!ingestAvailable\) return/);
  assert.match(page, /runtime\.tasks\.getDetail/);
  assert.match(page, /runtime\.analysis\.get/);
  assert.match(detail, /<IssueNotice actions=\{issueActions\} issue=\{activeIssue\}/);
  assert.doesNotMatch(processing, /runtime\.tasks\.(cancel|retry)/);
  assert.doesNotMatch(detail, /runtime\.tasks\.retry/);
  assert.doesNotMatch(processing, /retryOfTaskId/);
  assert.doesNotMatch(detail, /retryOfTaskId/);
  assert.match(processing, /navigate\(pathForRoute\("home"\)\)/);
  assert.match(detail, /navigate\(pathForRoute\("home"\)\)/);
  assert.match(processing, /重新提交链接/);
  assert.match(detail, /重新提交链接/);
  assert.doesNotMatch(processing, /code:\s*"APP_RUNTIME_UNAVAILABLE",\s*message:\s*"任务无法开始执行"/);
  assert.match(processing, /code:\s*"INTERNAL_UNKNOWN_ERROR",\s*message:\s*"任务无法开始执行"/);
});

test("real task pages constrain technical text and expose persisted stage percentages", () => {
  const home = `${read("pages/TaskHomePage.tsx")}\n${read("features/tasks/TaskHistory.tsx")}`;
  const processing = read("pages/TaskProcessingPage.tsx");
  const detail = read("pages/TaskDetailPage.tsx");
  const analysis = read("pages/TaskAnalysisPage.tsx");
  const progress = read("components/TaskProgressSteps.tsx");
  const css = read("styles/pages/tasks-runtime.css");

  assert.match(home, /className=\{localVideo \? undefined : "technical-value"\}/);
  assert.match(processing, /className="technical-value"/);
  assert.match(detail, /className="technical-value"/);
  assert.match(analysis, /className="technical-value"/);
  assert.match(processing, /task-page-actions mobile-action-group/);
  assert.match(detail, /analysis-confirm-card__actions mobile-action-group/);
  assert.match(progress, /role="progressbar"/);
  assert.match(progress, /task-progress-steps__percent/);
  assert.match(css, /\.progress-step__detail[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /@media\s*\(max-width:\s*26\.875rem\)[\s\S]*\.task-page-actions[^}]*grid-template-columns:\s*1fr/);
});

test("LatestReadGuard current() does not retire a sibling read; begin/invalidate do", async () => {
  const { LatestReadGuard, preferNewerByUpdatedAt } = await import("../apps/web/src/features/tasks/latest-read-guard");
  const guard = new LatestReadGuard();
  const load = guard.current();
  const incremental = guard.current();
  assert.equal(load, incremental);
  assert.equal(guard.isCurrent(load), true);
  assert.equal(guard.isCurrent(incremental), true);

  const next = guard.begin();
  assert.notEqual(next, load);
  assert.equal(guard.isCurrent(load), false);
  assert.equal(guard.isCurrent(next), true);

  guard.invalidate();
  assert.equal(guard.isCurrent(next), false);
  assert.equal(guard.isCurrent(guard.current()), true);

  const older = { id: "old", updatedAt: "2026-08-16T00:00:00.000Z" };
  const newer = { id: "new", updatedAt: "2026-08-16T00:01:00.000Z" };
  assert.equal(preferNewerByUpdatedAt(newer, older)?.id, "new");
  assert.equal(preferNewerByUpdatedAt(older, newer)?.id, "new");
  assert.equal(preferNewerByUpdatedAt(newer, undefined)?.id, "new");
});

test("processing load and subscribe share a non-bumping generation; analysis load keeps newer records", () => {
  const page = read("pages/TaskPage.tsx");

  assert.match(page, /const generation = latestRead\.current\.current\(\)/);
  assert.doesNotMatch(page, /latestRead\.current\.begin\(\)/);
  assert.match(page, /detailRead\.current\.begin\(\)/);
  assert.match(page, /setTask\(\(current\) => preferNewerByUpdatedAt\(current, nextTask\)\)/);
  assert.match(page, /setEvents\(\(current\) => mergeEvents\(current, event\)\)/);
  assert.match(page, /latestRead\.current\.invalidate\(\)/);
  assert.match(page, /detailRead\.current\.invalidate\(\)/);

  assert.match(page, /setRecord\(\(current\) => preferNewerByUpdatedAt\(current, nextRecord\)\)/);
  assert.match(page, /setRecord\(\(current\) => preferNewerByUpdatedAt\(current, event\.record\)\)/);
});

test("three task URL aliases mount one TaskPage and stay mounted after ingest completes", () => {
  const app = read("App.tsx");
  const page = read("pages/TaskPage.tsx");
  const processing = read("pages/TaskProcessingPage.tsx");
  const swipe = read("components/SwipeRouteViewport.tsx");
  const routerSource = read("router.ts");

  assert.match(routerSource, /export const taskPageAliasKeys/);
  assert.match(routerSource, /"task-processing"/);
  assert.match(routerSource, /"task-detail"/);
  assert.match(routerSource, /"task-analysis"/);
  assert.match(routerSource, /path:\s*"\/tasks\/:taskId\/processing"/);
  assert.match(routerSource, /path:\s*"\/tasks\/:taskId"/);
  assert.match(routerSource, /path:\s*"\/tasks\/:taskId\/analysis"/);

  assert.match(app, /isTaskPageAlias\(renderedRoute\.key\)/);
  assert.match(app, /<TaskPage key=\{taskId\}/);
  assert.equal([...app.matchAll(/<TaskPage\b/g)].length, 1);
  assert.doesNotMatch(app, /<TaskProcessingPage|<TaskDetailPage|<TaskAnalysisPage/);

  assert.match(page, /resolveTaskPageSurface/);
  assert.doesNotMatch(page, /isTerminalTaskStatus/);
  assert.doesNotMatch(page, /navigate\(taskDetailPath/);
  assert.doesNotMatch(page, /navigate\(taskAnalysisPath/);
  assert.doesNotMatch([page, processing, read("pages/TaskDetailPage.tsx"), read("pages/TaskAnalysisPage.tsx")].join("\n"), /查看任务详情|查看拆解结果|查看当前状态|查看拆解状态/);
  const processingShell = page.slice(page.indexOf("if (surface === \"processing\")"), page.indexOf("if (surface === \"completed-missing\""));
  assert.doesNotMatch(processingShell, /contextualAction=/);
  assert.match(processing, /进程在后台运行，可以放心离开此页/);
  assert.match(processing, /<Button variant="secondary"[\s\S]*?开始执行/);
  assert.doesNotMatch(processing, /<Button(?! variant="secondary")[\s\S]*?开始执行/);

  const surface = [page, processing, read("pages/TaskDetailPage.tsx"), read("pages/TaskAnalysisPage.tsx")].join("\n");
  assert.match(page, /LiveListReadReconciler<TaskChangeEventV1>/);
  assert.match(page, /from "\.\.\/features\/tasks\/latest-read-guard"/);
  assert.match(page, /from "\.\.\/hooks\/useAppResume"/);
  assert.match(surface, /ContentAnalysisDocument/);
  assert.match(surface, /TaskProgressSteps/);
  assert.match(surface, /ValidatedModuleProgress/);
  assert.match(surface, /RuntimeMediaFrame/);
  assert.match(surface, /IssueNotice/);
  assert.match(surface, /readContentAnalysis/);

  assert.doesNotMatch(swipe, /TaskPage|TaskProcessingPage|TaskDetailPage|TaskAnalysisPage/);
  assert.match(swipe, /SwipeRoutePreviewPane/);
  assert.doesNotMatch(swipe, /runtime\.tasks\.subscribe|runtime\.analysis\.subscribe/);
});

test("applyTaskDetailChange only accepts newer upserts for the same taskId", async () => {
  const { applyTaskDetailChange } = await import("../apps/web/src/pages/task-page-model") as {
    applyTaskDetailChange: (
      current: { readonly task: { readonly id: string; readonly updatedAt: string } } | undefined,
      event:
        | { readonly type: "upsert"; readonly task: { readonly id: string; readonly updatedAt: string } }
        | { readonly type: "deleted"; readonly taskId: string },
      taskId: string,
    ) => { readonly task: { readonly id: string; readonly updatedAt: string } } | undefined;
  };

  const current = { task: { id: "task-1", updatedAt: "2026-08-17T00:01:00.000Z" } };
  const older = { type: "upsert" as const, task: { id: "task-1", updatedAt: "2026-08-17T00:00:00.000Z" } };
  const newer = { type: "upsert" as const, task: { id: "task-1", updatedAt: "2026-08-17T00:02:00.000Z" } };
  const other = { type: "upsert" as const, task: { id: "task-2", updatedAt: "2026-08-17T00:03:00.000Z" } };

  assert.equal(applyTaskDetailChange(current, older, "task-1")?.task.updatedAt, current.task.updatedAt);
  assert.equal(applyTaskDetailChange(current, newer, "task-1")?.task.updatedAt, newer.task.updatedAt);
  assert.equal(applyTaskDetailChange(current, other, "task-1")?.task.id, "task-1");
  assert.equal(applyTaskDetailChange(current, { type: "deleted", taskId: "task-1" }, "task-1"), undefined);
  assert.equal(applyTaskDetailChange(current, { type: "deleted", taskId: "task-2" }, "task-1")?.task.id, "task-1");
});

test("打开已完成任务在两次读取结束前保持 loading，不闪缺失", async () => {
  const { resolveTaskPageSurface } = await import("../apps/web/src/pages/task-page-model") as {
    resolveTaskPageSurface?: (input: {
      readonly loading: boolean;
      readonly status?: string;
      readonly hasDetail: boolean;
    }) => string;
  };
  assert.equal(typeof resolveTaskPageSurface, "function");
  assert.equal(resolveTaskPageSurface?.({ loading: true, status: "succeeded", hasDetail: false }), "loading");
  assert.notEqual(resolveTaskPageSurface?.({ loading: true, status: "succeeded", hasDetail: false }), "completed-missing");
  assert.equal(resolveTaskPageSurface?.({ loading: false, status: "succeeded", hasDetail: true }), "completed");
  assert.equal(resolveTaskPageSurface?.({ loading: false, status: "degraded", hasDetail: true }), "completed");

  const page = read("pages/TaskPage.tsx");
  const processingFn = page.slice(page.indexOf("const loadProcessing"), page.indexOf("const loadDetail"));
  const loadFn = page.slice(page.indexOf("const load = useCallback"), page.indexOf("useAppResume(load)"));
  assert.doesNotMatch(processingFn, /setLoading\(false\)/);
  assert.match(loadFn, /loadProcessing/);
  assert.match(loadFn, /loadDetail/);
  assert.match(loadFn, /setLoading\(false\)/);
  assert.match(page, /resolveTaskPageSurface/);
});

test("failed interrupted cancelled 仍走处理页", async () => {
  const { isCompletedTaskSurface, resolveTaskPageSurface } = await import("../apps/web/src/pages/task-page-model") as {
    isCompletedTaskSurface?: (status: string) => boolean;
    resolveTaskPageSurface?: (input: {
      readonly loading: boolean;
      readonly status?: string;
      readonly hasDetail: boolean;
    }) => string;
  };
  assert.equal(typeof isCompletedTaskSurface, "function");
  assert.equal(typeof resolveTaskPageSurface, "function");
  for (const status of ["failed", "interrupted", "cancelled"] as const) {
    assert.equal(isCompletedTaskSurface?.(status), false);
    assert.equal(resolveTaskPageSurface?.({ loading: false, status, hasDetail: false }), "processing");
  }
  assert.equal(isCompletedTaskSurface?.("succeeded"), true);
  assert.equal(isCompletedTaskSurface?.("degraded"), true);
  assert.equal(isCompletedTaskSurface?.("running"), false);
  assert.equal(isCompletedTaskSurface?.("queued"), false);

  const page = read("pages/TaskPage.tsx");
  assert.match(page, /resolveTaskPageSurface/);
  assert.doesNotMatch(page, /isTerminalTaskStatus/);
});

test("处理页离开提示只在 queued/running 出现，失败态不伪造成进行中", async () => {
  const { showProcessingLeaveHint } = await import("../apps/web/src/pages/task-page-model") as {
    showProcessingLeaveHint?: (status: string) => boolean;
  };
  assert.equal(typeof showProcessingLeaveHint, "function");
  assert.equal(showProcessingLeaveHint?.("queued"), true);
  assert.equal(showProcessingLeaveHint?.("running"), true);
  for (const status of ["failed", "interrupted", "cancelled", "succeeded", "degraded"] as const) {
    assert.equal(showProcessingLeaveHint?.(status), false);
  }

  const processing = read("pages/TaskProcessingPage.tsx");
  assert.match(processing, /showProcessingLeaveHint\(task\.status\) \? <p className="task-processing-leave-hint">进程在后台运行，可以放心离开此页<\/p> : null/);
  assert.match(processing, /TaskProgressSteps/);
  assert.match(processing, /IssueNotice/);
});

test("完成态用共享 Tabs 恢复 URL 分栏，并按阶段给出底部主操作", async () => {
  const model = await import("../apps/web/src/pages/task-page-model") as {
    sourceTabLabel?: (contentType?: string) => string;
    taskResultTabs?: (contentType?: string) => readonly string[];
    taskResultTabFromPath?: (pathname: string) => string;
    pathForTaskResultTab?: (taskId: string, tab: string) => string;
    createPagePathWithSource?: (taskId: string) => string;
    sourceIdFromSearch?: (search: string) => string;
    navigateToCreateWithSource?: (navigate: (path: string) => void, taskId: string) => void;
    resolveCompletedBarAction?: (input: {
      readonly primary: string;
      readonly confirmationOpen: boolean;
      readonly deleteConfirmationOpen: boolean;
    }) => string;
    resolveCompletedPrimaryAction?: (input: {
      readonly analysisStatus?: string;
      readonly analysisAvailable: boolean;
      readonly hasEvidence: boolean;
    }) => string;
    syncTaskResultTabPath?: (taskId: string, tab: string) => void;
  };

  assert.equal(typeof model.sourceTabLabel, "function");
  assert.equal(typeof model.taskResultTabs, "function");
  assert.equal(typeof model.taskResultTabFromPath, "function");
  assert.equal(typeof model.pathForTaskResultTab, "function");
  assert.equal(typeof model.createPagePathWithSource, "function");
  assert.equal(typeof model.sourceIdFromSearch, "function");
  assert.equal(typeof model.resolveCompletedPrimaryAction, "function");
  assert.equal(typeof model.syncTaskResultTabPath, "function");

  assert.equal(model.sourceTabLabel?.("video"), "原始文稿");
  assert.equal(model.sourceTabLabel?.("image_text"), "图文正文");
  assert.equal(model.sourceTabLabel?.("unknown"), "原始文稿");
  assert.deepEqual(model.taskResultTabs?.("video"), ["原始文稿", "AI自动拆解"]);
  assert.deepEqual(model.taskResultTabs?.("image_text"), ["图文正文", "AI自动拆解"]);
  assert.equal(model.taskResultTabFromPath?.("/tasks/task-1/analysis"), "analysis");
  assert.equal(model.taskResultTabFromPath?.("/tasks/task-1"), "source");
  assert.equal(model.taskResultTabFromPath?.("/tasks/task-1/processing"), "source");
  assert.equal(model.pathForTaskResultTab?.("task-1", "analysis"), "/tasks/task-1/analysis");
  assert.equal(model.pathForTaskResultTab?.("task-1", "source"), "/tasks/task-1");
  assert.equal(model.createPagePathWithSource?.("task/1"), "/create?sourceId=task%2F1");
  assert.equal(model.sourceIdFromSearch?.("?sourceId=task-9"), "task-9");
  assert.equal(model.sourceIdFromSearch?.("sourceId=task-9&x=1"), "task-9");
  assert.equal(model.sourceIdFromSearch?.(""), "");
  assert.equal(model.resolveCompletedPrimaryAction?.({ analysisStatus: "not_started", analysisAvailable: true, hasEvidence: true }), "start-analysis");
  assert.equal(model.resolveCompletedPrimaryAction?.({ analysisStatus: "failed", analysisAvailable: true, hasEvidence: true }), "start-analysis");
  assert.equal(model.resolveCompletedPrimaryAction?.({ analysisStatus: "succeeded", analysisAvailable: true, hasEvidence: true }), "next-steps");
  assert.equal(model.resolveCompletedPrimaryAction?.({ analysisStatus: "running", analysisAvailable: true, hasEvidence: true }), "none");
  assert.equal(model.resolveCompletedPrimaryAction?.({ analysisStatus: "not_started", analysisAvailable: true, hasEvidence: false }), "none");
  assert.equal(model.resolveCompletedPrimaryAction?.({ analysisStatus: "not_started", analysisAvailable: false, hasEvidence: true }), "none");

  const page = read("pages/TaskPage.tsx");
  const detail = read("pages/TaskDetailPage.tsx");
  const analysis = read("pages/TaskAnalysisPage.tsx");
  const modelSource = read("pages/task-page-model.ts");
  const create = read("pages/CreatePage.tsx");
  const home = read("pages/TaskHomePage.tsx");
  const completed = [page, detail, analysis, modelSource].join("\n");

  assert.match(detail, /from "\.\.\/components\/Tabs"/);
  assert.match(detail, /<Tabs\b/);
  assert.match(detail, /<TabPanel\b/);
  assert.doesNotMatch(detail, /role="tablist"/);
  assert.match(completed, /AI自动拆解/);
  assert.match(detail, /原始文稿/);
  assert.match(detail, /图文正文/);
  assert.match(page, /taskResultTabFromPath/);
  assert.match(page, /syncTaskResultTabPath/);
  assert.match(page, /popstate/);
  assert.match(page, /contextualAction=/);
  assert.match(completed, /开始 AI 拆解/);
  assert.match(completed, /存为模板/);
  assert.match(completed, /用它做视频/);
  assert.match(completed, /createPagePathWithSource/);
  assert.match(completed, /重新拆解/);
  assert.match(completed, /role="menuitem"/);
  assert.match(completed, /确认删除这个任务/);
  assert.doesNotMatch(detail, /<Button[^>]*>删除任务</);
  assert.doesNotMatch(detail, /<Button[^>]*>重新拆解</);
  assert.doesNotMatch(analysis, /前往模板管理保存结构/);
  assert.match(create, /consumeCreateSourceIdFromSearch/);
  assert.match(home, /from "\.\.\/components\/Tabs"/);
  assert.match(home, /<Tabs\b/);
  assert.match(home, /"粘贴链接"/);
  assert.match(home, /"上传视频"/);
  assert.doesNotMatch(home, /task-source-index/);
  assert.doesNotMatch(home, />01</);
  assert.doesNotMatch(home, />02</);

  assert.equal(typeof model.navigateToCreateWithSource, "function");
  assert.equal(typeof model.resolveCompletedBarAction, "function");
  assert.match(detail, /navigateToCreateWithSource/);
  assert.doesNotMatch(detail, /navigate\(createPagePathWithSource/);
  assert.match(detail, /resolveCompletedBarAction/);
  assert.match(detail, /confirmationOpen/);
  assert.match(detail, /deleteConfirmationOpen/);
  const confirmCard = detail.slice(detail.indexOf("{confirmationOpen ?"), detail.indexOf("{activeTab !== \"analysis\""));
  assert.match(confirmCard, /暂不运行/);
  assert.doesNotMatch(confirmCard, /开始拆解/);
  assert.match(detail, /variant="secondary"[^>]*>\{pendingAction === "delete"/);
});

test("用它做视频先进入 /create 再写 sourceId，确认态底栏不再出现第二个主按钮", async () => {
  const model = await import("../apps/web/src/pages/task-page-model") as {
    createPagePathWithSource: (taskId: string) => string;
    sourceIdFromSearch: (search: string) => string;
    navigateToCreateWithSource: (navigate: (path: string) => void, taskId: string) => void;
    resolveCompletedBarAction: (input: {
      readonly primary: string;
      readonly confirmationOpen: boolean;
      readonly deleteConfirmationOpen: boolean;
    }) => string;
  };
  const { matchRoute, pathForRoute } = await import("../apps/web/src/router");

  assert.equal(matchRoute(model.createPagePathWithSource("task-88")).key, "not-found");
  assert.equal(matchRoute(pathForRoute("create")).key, "create");

  const location = { pathname: "/tasks/task-88", search: "" };
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window: unknown }).window = {
    location,
    history: {
      state: {},
      replaceState(_data: unknown, _title: string, url: string) {
        const parsed = new URL(url, "https://hongtai.local");
        location.pathname = parsed.pathname;
        location.search = parsed.search;
      },
    },
  };

  try {
    const navigated: string[] = [];
    model.navigateToCreateWithSource((path) => {
      navigated.push(path);
    }, "task-88");
    assert.equal(navigated.length, 1);
    assert.equal(matchRoute(navigated[0] ?? "").key, "create");
    assert.doesNotMatch(navigated[0] ?? "", /\?/);
    assert.equal(model.sourceIdFromSearch(location.search), "task-88");
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window: unknown }).window = previousWindow;
  }

  assert.equal(model.resolveCompletedBarAction({ primary: "start-analysis", confirmationOpen: false, deleteConfirmationOpen: false }), "start-analysis");
  assert.equal(model.resolveCompletedBarAction({ primary: "next-steps", confirmationOpen: false, deleteConfirmationOpen: false }), "next-steps");
  assert.equal(model.resolveCompletedBarAction({ primary: "start-analysis", confirmationOpen: true, deleteConfirmationOpen: false }), "confirm-analysis");
  assert.equal(model.resolveCompletedBarAction({ primary: "next-steps", confirmationOpen: true, deleteConfirmationOpen: false }), "confirm-analysis");
  assert.equal(model.resolveCompletedBarAction({ primary: "next-steps", confirmationOpen: false, deleteConfirmationOpen: true }), "none");
  assert.equal(model.resolveCompletedBarAction({ primary: "start-analysis", confirmationOpen: true, deleteConfirmationOpen: true }), "none");
});

test("首页来源用 Tabs，唯一主按钮跟在输入区后，成功后进入 /tasks/:id", () => {
  const home = read("pages/TaskHomePage.tsx");
  const history = read("features/tasks/TaskHistory.tsx");
  const css = read("styles/pages/tasks-runtime.css");

  assert.match(home, /from "\.\.\/components\/Tabs"/);
  assert.match(home, /<Tabs\b/);
  assert.match(home, /<TabPanel\b/);
  assert.match(home, /tabs=\{SOURCE_TABS\}|tabs=\{\["粘贴链接", "上传视频"\]\}/);
  assert.match(home, /"粘贴链接"/);
  assert.match(home, /"上传视频"/);
  assert.doesNotMatch(home, /contextualAction=\{/);
  assert.match(home, /\{primaryAction\}/);
  assert.match(home, /\{submitting \? "正在创建本地任务" : "开始拆解"\}/);
  assert.match(home, /\{videoImporting \? "正在识别视频内容" : "选择视频并拆解"\}/);
  assert.match(home, /disabled=\{!ingestAvailable \|\| !inspection\?\.ok \|\| submitting \|\| videoImporting\}/);
  assert.match(home, /className=\{videoImporting \? "is-busy" : ""\}/);
  assert.match(home, /id="task-share-input"/);
  assert.match(home, /aria-label="粘贴"/);
  assert.match(home, /navigator\.clipboard\.readText/);
  assert.match(home, /已识别 \{platformLabel/);
  assert.match(home, /选择一段 MP4 视频/);
  assert.match(home, /250MB/);
  assert.match(home, /只保存在本机/);
  assert.match(home, /<ValidatedModuleProgress/);
  assert.match(home, /navigate\(taskDetailPath\(result\.task\.id\)\)/);
  assert.match(home, /navigate\(taskDetailPath\(record\.taskId\)\)/);
  assert.match(home, /navigate\(taskDetailPath\(recovered\.record\.taskId\)\)/);
  assert.match(history, /navigate\(taskDetailPath\(task\.id\)\)/);
  assert.doesNotMatch(home, /taskAnalysisPath/);
  assert.doesNotMatch(home, /taskProcessingPath/);
  assert.doesNotMatch(home, /task-source-index/);
  assert.doesNotMatch(home, />01</);
  assert.doesNotMatch(home, />02</);
  assert.doesNotMatch(home, /开始采集/);
  assert.doesNotMatch(home, /"选择本地视频"/);
  assert.doesNotMatch(home, /<GlassCard[\s\S]*<Button[\s\S]*<\/GlassCard>/);
  assert.doesNotMatch(css, /\.task-source-index/);
  assert.match(css, /\.page-task-home[^{]*\{[^}]*padding-bottom:\s*var\(--space-4\)/);
});
