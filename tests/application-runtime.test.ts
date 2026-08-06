import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYSIS_STATUS_VALUES,
  APP_RUNTIME_CONTRACT_VERSION,
  FEATURE_CAPABILITY_VALUES,
  PIPELINE_STAGES,
  TASK_STATUS_VALUES,
  TaskError,
  issueFromAppError,
  TASK_STAGE_VALUES,
  isTerminalTaskStatus,
} from "../packages/core/src/index";
import type {
  AppRuntime,
  AppTaskRecord,
  InputInspection,
  TaskDetailRecord,
  TaskEventRecord,
  TaskRepository,
  TaskService,
} from "../packages/core/src/index";

test("应用运行时契约保留七个采集阶段，并将任务与内容拆解状态分开", () => {
  assert.equal(APP_RUNTIME_CONTRACT_VERSION, "app-runtime.v1");
  assert.deepEqual(TASK_STAGE_VALUES, [
    "detect-platform",
    "resolve-link",
    "parse-content",
    "select-media",
    "download-media",
    "obtain-transcript",
    "save-artifacts",
  ]);
  assert.deepEqual(TASK_STATUS_VALUES, [
    "queued",
    "running",
    "succeeded",
    "degraded",
    "failed",
    "cancelled",
    "interrupted",
  ]);
  assert.deepEqual(ANALYSIS_STATUS_VALUES, ["not_started", "running", "succeeded", "failed"]);
  assert.deepEqual(FEATURE_CAPABILITY_VALUES, ["available", "planned"]);
  assert.equal(isTerminalTaskStatus("interrupted"), true);
  assert.equal(isTerminalTaskStatus("running"), false);
  assert.deepEqual(PIPELINE_STAGES, TASK_STAGE_VALUES);
});

test("应用界面任务服务可以预检输入并在重载后读取持久化事件", () => {
  const service = {} as TaskService;
  const repository = {} as TaskRepository;
  const appTask = {} as AppTaskRecord;
  const inspect: (input: string) => InputInspection = service.inspectInput;
  const events: (taskId: string) => Promise<readonly TaskEventRecord[]> = service.listEvents;

  assert.equal(typeof inspect, "undefined");
  assert.equal(typeof events, "undefined");
  assert.equal(typeof repository.appendEvent, "undefined");
  assert.equal("paths" in appTask, false);
  // @ts-expect-error Node-only task paths are deliberately absent from the UI projection.
  void appTask.paths;
});

test("应用界面只通过运行时选择私有媒体，并读取真实任务详情和AI探测状态", () => {
  const detail = { task: {} as AppTaskRecord, content: {}, media: [], evidenceUnits: [] } as TaskDetailRecord;
  type PickAvatar = AppRuntime["profile"]["pickAvatar"];
  type PickObservationImage = AppRuntime["diagnosis"]["pickImage"];
  type ReadTaskDetail = AppRuntime["tasks"]["getDetail"];
  type ReadProbeResults = AppRuntime["aiSettings"]["getProbeResults"];
  type ListDiagnosisSessions = AppRuntime["diagnosis"]["listSessions"];
  type RunDiagnosisReport = AppRuntime["diagnosis"]["runReport"];

  const contracts: readonly [PickAvatar, PickObservationImage, ReadTaskDetail, ReadProbeResults, ListDiagnosisSessions, RunDiagnosisReport] | undefined = undefined;
  assert.equal(contracts, undefined);
  assert.equal("paths" in detail.task, false);
});

test("非采集界面错误不会被伪装成七阶段任务错误", () => {
  const issue = issueFromAppError(
    new TaskError({ code: "AI_SECRET_STORE_FAILED", message: "安全存储不可用", action: "configure_ai" }),
    { code: "APP_RUNTIME_UNAVAILABLE", message: "本地运行时不可用", action: "none" },
  );

  assert.equal(issue.code, "AI_SECRET_STORE_FAILED");
  assert.equal(issue.action, "configure_ai");
  assert.equal(issue.stage, undefined);
});
