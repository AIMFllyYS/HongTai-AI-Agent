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
    "pages/TaskProcessingPage.tsx",
    "pages/TaskDetailPage.tsx",
    "pages/TaskAnalysisPage.tsx",
  ]) {
    assert.equal(existsSync(join(webRoot, relativePath)), true, `${relativePath} should exist`);
    assert.doesNotMatch(read(relativePath), /data\/fixtures/);
  }

  const app = read("App.tsx");
  for (const component of ["TaskHomePage", "TaskProcessingPage", "TaskDetailPage", "TaskAnalysisPage"]) {
    assert.match(app, new RegExp(component));
  }
  assert.match(read("pages/TaskHomePage.tsx"), /runtime\.tasks\.inspectInput/);
  assert.match(read("pages/TaskHomePage.tsx"), /submitLocalTask\(runtime\.tasks/);
  assert.match(read("pages/TaskHomePage.tsx"), /runtime\.analysis\.importVideo\(\)/);
  assert.match(read("pages/TaskHomePage.tsx"), /sourceKind === "local_video"/);
  assert.match(read("pages/TaskProcessingPage.tsx"), /runtime\.tasks\.subscribe/);
  assert.match(read("pages/TaskProcessingPage.tsx"), /runtime\.tasks\.listEvents/);
  assert.match(read("pages/TaskDetailPage.tsx"), /runtime\.tasks\.getDetail/);
  assert.match(read("pages/TaskDetailPage.tsx"), /runtime\.analysis\.run/);
  assert.match(read("pages/TaskDetailPage.tsx"), /runtime\.tasks\.delete\(taskId\)/);
  assert.match(read("pages/TaskAnalysisPage.tsx"), /runtime\.analysis\.get/);
});

test("every live task page re-reads its safe persisted DTOs after app resume", () => {
  const pages = new Map([
    ["pages/TaskHomePage.tsx", "loadHistory"],
    ["pages/TaskProcessingPage.tsx", "load"],
    ["pages/TaskDetailPage.tsx", "load"],
    ["pages/TaskAnalysisPage.tsx", "load"],
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
  const processing = read("pages/TaskProcessingPage.tsx");
  const detail = read("pages/TaskDetailPage.tsx");
  const analysis = read("pages/TaskAnalysisPage.tsx");

  assert.match(home, /runtime\.tasks\.inspectInput/);
  assert.match(home, /runtime\.tasks\.list/);
  assert.match(home, /disabled=\{!ingestAvailable \|\| !inspection\?\.ok \|\| submitting \|\| videoImporting\}/);
  assert.doesNotMatch(home, /if \(!ingestAvailable\) return/);
  assert.doesNotMatch(processing, /if \(!ingestAvailable\) return/);
  assert.match(detail, /runtime\.tasks\.getDetail/);
  assert.match(analysis, /runtime\.analysis\.get/);
  assert.match(detail, /<IssueNotice issue=\{issue\}/);
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
  const home = read("pages/TaskHomePage.tsx");
  const processing = read("pages/TaskProcessingPage.tsx");
  const detail = read("pages/TaskDetailPage.tsx");
  const analysis = read("pages/TaskAnalysisPage.tsx");
  const progress = read("components/TaskProgressSteps.tsx");
  const css = read("styles/pages/tasks-runtime.css");

  assert.match(home, /className="technical-value"/);
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
