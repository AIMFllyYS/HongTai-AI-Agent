import assert from "node:assert/strict";
import test from "node:test";

import type { AiGenerateRequest, AiProvider } from "@hongtai/ai";
import type { TaskDetailRecord } from "@hongtai/core";

import { RuntimeOperationRegistry } from "./runtime-operation-registry.js";
import { StandaloneAnalysisService } from "./standalone-analysis-service.js";

const result = {
  schemaVersion: "content-analysis.v1",
  source: { taskId: "task-1", platform: "bilibili", contentType: "video", sourceKind: "asr" },
  overview: { summary: "从真实证据中拆解", theme: "内容方法", targetAudiences: ["门店经营者"], communicationGoal: "提供参考" },
  hook: { type: "pain_point", description: "先提出痛点", mechanism: "建立共鸣", evidenceRefs: ["segment-1"] },
  painPoints: [{ description: "表达不清晰", evidenceRefs: ["segment-1"] }],
  emotionalDrivers: [{ description: "减少焦虑", evidenceRefs: ["segment-1"] }],
  structure: [{ order: 1, role: "opening", summary: "提出问题", techniques: ["提问"], evidenceRefs: ["segment-1"] }],
  coreClaims: [{ claim: "先明确受众", supportLevel: "explicit", evidenceRefs: ["segment-1"] }],
  style: { tones: ["直接"], pacing: "紧凑", languagePatterns: ["短句"], interactionMechanisms: ["提问"] },
  reusableTemplate: { formula: "痛点-方法", steps: ["提出痛点"], variableSlots: ["行业痛点"], doNotCopy: ["具体原句"] },
  risks: [{ category: "unsupported_claim", level: "low", description: "需核对事实", evidenceRefs: ["segment-1"], suggestion: "补充依据" }],
} as const;

function analysisModuleContent(
  request: AiGenerateRequest,
  source: Pick<typeof result, "overview" | "hook" | "painPoints" | "emotionalDrivers" | "structure" | "coreClaims" | "style" | "reusableTemplate" | "risks"> = result,
): string {
  if (request.jsonSchema?.name !== "content_analysis_single_response_v1") {
    throw new Error(`unexpected analysis schema: ${request.jsonSchema?.name ?? "none"}`);
  }
  return JSON.stringify({
    overview: source.overview,
    hookDrivers: { hook: source.hook, painPoints: source.painPoints, emotionalDrivers: source.emotionalDrivers },
    structureClaims: { structure: source.structure, coreClaims: source.coreClaims },
    styleTemplate: { style: source.style, reusableTemplate: source.reusableTemplate },
    risksBoundaries: { risks: source.risks },
  });
}

function detail(): TaskDetailRecord {
  const evidenceUnits = [{ id: "segment-1", source: "transcript" as const, text: "真实转写证据：先明确受众，再给出方法。", startSeconds: 0, endSeconds: 5 }];
  return {
    task: { id: "task-1", sourceUrl: "https://www.bilibili.com/video/BV1xx", status: "succeeded", platform: "bilibili", contentType: "video", speechStatus: "transcribed", analysisStatus: "not_started", media: [], createdAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z", issues: [] },
    content: { title: "真实标题", author: "真实作者" },
    media: [],
    transcript: { source: "asr", segments: evidenceUnits },
    evidenceUnits,
  };
}

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve };
}

test("StandaloneAnalysisService persists only the formal content-analysis document and keeps it outside the seven stages", async () => {
  const values = new Map<string, string>();
  const statuses: string[] = [];
  const provider: AiProvider = {
    generate: async (request) => {
      const content = analysisModuleContent(request);
      await request.onEvent?.({ type: "reasoning_delta", delta: "internal reasoning" });
      await request.onEvent?.({ type: "content_delta", delta: content });
      await request.onEvent?.({ type: "completed" });
      return { content, reasoning: "internal reasoning" };
    },
    transcribe: async () => "",
  };
  const service = new StandaloneAnalysisService({
    files: {
      readText: async ({ taskId, relativePath }: { readonly taskId: string; readonly relativePath: string }) => ({ value: values.get(`${taskId}/${relativePath}`) }),
      writeText: async ({ taskId, relativePath, value }: { readonly taskId: string; readonly relativePath: string; readonly value: string }) => { values.set(`${taskId}/${relativePath}`, value); },
    } as never,
    tasks: {
      importVideo: async () => { throw new Error("unused"); },
      start: async () => { throw new Error("unused"); },
      getDetail: async () => detail(),
      setAnalysisStatus: async (_taskId, status) => { statuses.push(status); },
    },
    getProvider: async () => provider,
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  });

  const events: unknown[] = [];
  const record = await service.run("task-1", async (event) => { events.push(event); });

  assert.equal(record.status, "succeeded");
  assert.equal(record.result?.schemaVersion, "content-analysis.v1");
  assert.deepEqual(statuses, ["running", "succeeded"]);
  assert.doesNotMatch(values.get("task-1/analysis.json") ?? "", /internal reasoning|rawResponse/);
  assert.equal(events.some((event) => (event as { readonly type?: string }).type === "progress"), true);
  assert.equal(events.some((event) => (event as { readonly type?: string }).type === "completed"), true);
  assert.match(JSON.stringify(events), /"moduleId":"overview"/);
  assert.match(JSON.stringify(events), /从真实证据中拆解/);
  assert.match(JSON.stringify(events), /internal reasoning/);
  assert.doesNotMatch(JSON.stringify(events), /真实转写证据/);
});

test("StandaloneAnalysisService recovers a running analysis and synchronizes its task projection", async () => {
  const values = new Map<string, string>([[
    "task-1/analysis.json",
    JSON.stringify({
      taskId: "task-1",
      status: "running",
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:01.000Z",
    }),
  ]]);
  let analysisStatus: "running" | "failed" = "running";
  const service = new StandaloneAnalysisService({
    files: {
      readText: async ({ taskId, relativePath }: { readonly taskId: string; readonly relativePath: string }) => ({ value: values.get(`${taskId}/${relativePath}`) }),
      writeText: async ({ taskId, relativePath, value }: { readonly taskId: string; readonly relativePath: string; readonly value: string }) => { values.set(`${taskId}/${relativePath}`, value); },
      listTaskIds: async () => ({ taskIds: ["task-1"] }),
    } as never,
    tasks: {
      importVideo: async () => { throw new Error("unused"); },
      start: async () => { throw new Error("unused"); },
      getDetail: async () => detail(),
      list: async () => [{ ...detail().task, analysisStatus }],
      setAnalysisStatus: async (_taskId, status) => { analysisStatus = status as "running" | "failed"; },
    },
    getProvider: async () => ({ generate: async () => ({ content: "", reasoning: "" }), transcribe: async () => "" }),
    now: () => new Date("2026-08-12T01:02:03.000Z"),
  });

  assert.deepEqual(await service.inspectUnfinishedWork(), [{
    kind: "content-analysis",
    id: "task-1",
    source: "persisted",
    execution: "in-process",
  }]);
  assert.equal((await service.recoverInterruptedWork()).length, 1);
  assert.equal((await service.recoverInterruptedWork()).length, 0);

  const recovered = await service.get("task-1");
  assert.equal(recovered?.status, "failed");
  assert.equal(recovered?.createdAt, "2026-08-07T00:00:00.000Z");
  assert.equal(recovered?.updatedAt, "2026-08-12T01:02:03.000Z");
  assert.equal(recovered?.issue?.code, "TASK_INTERRUPTED");
  assert.equal(recovered?.issue?.action, "retry");
  assert.equal(analysisStatus, "failed");
});

test("StandaloneAnalysisService registers the real analysis promise lifetime", async () => {
  const values = new Map<string, string>();
  const entered = deferred();
  const release = deferred();
  const operations = new RuntimeOperationRegistry();
  const service = new StandaloneAnalysisService({
    files: {
      readText: async ({ taskId, relativePath }: { readonly taskId: string; readonly relativePath: string }) => ({ value: values.get(`${taskId}/${relativePath}`) }),
      writeText: async ({ taskId, relativePath, value }: { readonly taskId: string; readonly relativePath: string; readonly value: string }) => { values.set(`${taskId}/${relativePath}`, value); },
    } as never,
    tasks: {
      importVideo: async () => { throw new Error("unused"); },
      start: async () => { throw new Error("unused"); },
      getDetail: async () => detail(),
      setAnalysisStatus: async () => undefined,
    },
    getProvider: async () => ({
      generate: async (request) => {
        entered.resolve();
        await release.promise;
        return { content: analysisModuleContent(request), reasoning: "" };
      },
      transcribe: async () => "",
    }),
    operations,
  });

  const running = service.run("task-1");
  await entered.promise;
  assert.deepEqual(operations.list(), [{
    kind: "content-analysis",
    id: "task-1",
    source: "memory",
    execution: "in-process",
  }]);
  release.resolve();
  await running;
  assert.deepEqual(operations.list(), []);
});

test("StandaloneAnalysisService single-flights by task id and replays runtime-only reasoning to late subscribers", async () => {
  const values = new Map<string, string>();
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  const service = new StandaloneAnalysisService({
    files: {
      readText: async ({ taskId, relativePath }: { readonly taskId: string; readonly relativePath: string }) => ({ value: values.get(`${taskId}/${relativePath}`) }),
      writeText: async ({ taskId, relativePath, value }: { readonly taskId: string; readonly relativePath: string; readonly value: string }) => { values.set(`${taskId}/${relativePath}`, value); },
    } as never,
    tasks: {
      importVideo: async () => { throw new Error("unused"); },
      start: async () => { throw new Error("unused"); },
      getDetail: async () => detail(),
      setAnalysisStatus: async () => undefined,
    },
    getProvider: async () => ({
      generate: async (request) => {
        calls += 1;
        if (calls === 1) {
          await request.onEvent?.({ type: "reasoning_delta", delta: "late analysis reasoning" });
          entered.resolve();
          await release.promise;
        }
        const content = analysisModuleContent(request);
        await request.onEvent?.({ type: "content_delta", delta: content });
        await request.onEvent?.({ type: "completed" });
        return { content, reasoning: "late analysis reasoning" };
      },
      transcribe: async () => "",
    }),
  });

  const first = service.run("task-1");
  await entered.promise;
  const lateEvents: import("@hongtai/core").ContentAnalysisStreamEvent[] = [];
  const unsubscribe = service.subscribe("task-1", async (event) => {
    lateEvents.push(event);
    if (event.type === "completed") {
      assert.equal((await service.get("task-1"))?.status, "succeeded", "completed must follow formal persistence");
    }
  });
  const second = service.run("task-1");

  assert.strictEqual(second, first, "same task id must return the same in-flight Promise");
  assert.equal(lateEvents[0]?.type, "progress", "a late page must immediately receive the active cumulative snapshot");
  if (lateEvents[0]?.type === "progress") {
    assert.equal(lateEvents[0].taskId, "task-1");
    assert.equal(lateEvents[0].progress.modules[0]?.moduleId, "overview");
    assert.equal(lateEvents[0].progress.modules[0]?.status, "running");
    assert.deepEqual(lateEvents[0].progress.thinking, {
      status: "streaming",
      text: "late analysis reasoning",
    });
  }

  release.resolve();
  const [left, right] = await Promise.all([first, second]);
  unsubscribe();
  assert.strictEqual(left, right);
  assert.equal(calls, 1);
  assert.equal(lateEvents.at(-1)?.type, "completed");
  assert.doesNotMatch(JSON.stringify([...values.values()]), /late analysis reasoning|"thinking"/);
  const afterCompletion: import("@hongtai/core").ContentAnalysisStreamEvent[] = [];
  const unsubscribeAfterCompletion = service.subscribe("task-1", (event) => { afterCompletion.push(event); });
  assert.deepEqual(afterCompletion, [], "terminal runs must clear their runtime-only snapshot");
  unsubscribeAfterCompletion();
});

test("StandaloneAnalysisService unsubscribe and listener failures never cancel formal persistence", async () => {
  const values = new Map<string, string>();
  const service = new StandaloneAnalysisService({
    files: {
      readText: async ({ taskId, relativePath }: { readonly taskId: string; readonly relativePath: string }) => ({ value: values.get(`${taskId}/${relativePath}`) }),
      writeText: async ({ taskId, relativePath, value }: { readonly taskId: string; readonly relativePath: string; readonly value: string }) => { values.set(`${taskId}/${relativePath}`, value); },
    } as never,
    tasks: {
      importVideo: async () => { throw new Error("unused"); },
      start: async () => { throw new Error("unused"); },
      getDetail: async () => detail(),
      setAnalysisStatus: async () => undefined,
    },
    getProvider: async () => ({
      generate: async (request) => ({ content: analysisModuleContent(request), reasoning: "" }),
      transcribe: async () => "",
    }),
  });
  const unsubscribe = service.subscribe("task-1", () => { throw new Error("view disappeared"); });
  const running = service.run("task-1");
  unsubscribe();

  const completed = await running;

  assert.equal(completed.status, "succeeded");
  assert.equal((await service.get("task-1"))?.status, "succeeded");
});

test("StandaloneAnalysisService never lets a slow page listener stall the formal flow", { timeout: 1_000 }, async () => {
  const values = new Map<string, string>();
  const providerEntered = deferred();
  const neverSettles = new Promise<void>(() => undefined);
  const service = new StandaloneAnalysisService({
    files: {
      readText: async ({ taskId, relativePath }: { readonly taskId: string; readonly relativePath: string }) => ({ value: values.get(`${taskId}/${relativePath}`) }),
      writeText: async ({ taskId, relativePath, value }: { readonly taskId: string; readonly relativePath: string; readonly value: string }) => { values.set(`${taskId}/${relativePath}`, value); },
    } as never,
    tasks: {
      importVideo: async () => { throw new Error("unused"); },
      start: async () => { throw new Error("unused"); },
      getDetail: async () => detail(),
      setAnalysisStatus: async () => undefined,
    },
    getProvider: async () => ({
      generate: async (request) => {
        providerEntered.resolve();
        return { content: analysisModuleContent(request), reasoning: "" };
      },
      transcribe: async () => "",
    }),
  });
  const unsubscribe = service.subscribe("task-1", () => neverSettles);
  const running = service.run("task-1");

  await providerEntered.promise;
  unsubscribe();

  assert.equal((await running).status, "succeeded");
});

test("StandaloneAnalysisService keeps three validated modules on module-four failure and retries from module one", async () => {
  const values = new Map<string, string>();
  const schemas: string[] = [];
  let styleAttempts = 0;
  const service = new StandaloneAnalysisService({
    files: {
      readText: async ({ taskId, relativePath }: { readonly taskId: string; readonly relativePath: string }) => ({ value: values.get(`${taskId}/${relativePath}`) }),
      writeText: async ({ taskId, relativePath, value }: { readonly taskId: string; readonly relativePath: string; readonly value: string }) => { values.set(`${taskId}/${relativePath}`, value); },
    } as never,
    tasks: {
      importVideo: async () => { throw new Error("unused"); },
      start: async () => { throw new Error("unused"); },
      getDetail: async () => detail(),
      setAnalysisStatus: async () => undefined,
    },
    getProvider: async () => ({
      generate: async (request) => {
        const schema = request.jsonSchema?.name ?? "none";
        schemas.push(schema);
        let content = analysisModuleContent(request);
        if (styleAttempts++ < 2) {
          const invalid = JSON.parse(content) as { styleTemplate: unknown };
          invalid.styleTemplate = {};
          content = JSON.stringify(invalid);
        }
        await request.onEvent?.({ type: "content_delta", delta: content });
        await request.onEvent?.({ type: "completed" });
        return { content, reasoning: "" };
      },
      transcribe: async () => "",
    }),
  });
  const events: import("@hongtai/core").ContentAnalysisStreamEvent[] = [];

  await assert.rejects(() => service.run("task-1", (event) => { events.push(event); }));

  const failed = events.at(-1);
  assert.equal(failed?.type, "failed");
  if (failed?.type === "failed") {
    assert.equal(failed.failedModuleId, "style-template");
    assert.deepEqual(failed.progress.modules.map(({ moduleId, status }) => ({ moduleId, status })), [
      { moduleId: "overview", status: "succeeded" },
      { moduleId: "hook-drivers", status: "succeeded" },
      { moduleId: "structure-claims", status: "succeeded" },
      { moduleId: "style-template", status: "failed" },
      { moduleId: "risks-boundaries", status: "pending" },
    ]);
  }
  const failedRecord = JSON.parse(values.get("task-1/analysis.json") ?? "{}") as Record<string, unknown>;
  assert.equal(failedRecord.status, "failed");
  assert.equal("result" in failedRecord, false);
  assert.deepEqual(schemas.slice(0, 2), [
    "content_analysis_single_response_v1",
    "content_analysis_single_response_v1",
  ]);

  assert.equal((await service.run("task-1")).status, "succeeded");
  assert.equal(schemas[2], "content_analysis_single_response_v1");
});

test("StandaloneAnalysisService automatically runs ingest then formal analysis for a picked local video", async () => {
  const calls: string[] = [];
  const localResult = { ...result, source: { taskId: "task-local", platform: "local_upload", contentType: "video", sourceKind: "asr" } } as const;
  const provider: AiProvider = {
    generate: async (request) => ({ content: analysisModuleContent(request, localResult), reasoning: "must not persist" }),
    transcribe: async () => "",
  };
  const values = new Map<string, string>();
  const localDetail: TaskDetailRecord = {
    ...detail(),
    task: { ...detail().task, id: "task-local", sourceUrl: "", sourceKind: "local_video", platform: undefined },
  };
  const service = new StandaloneAnalysisService({
    files: {
      readText: async ({ taskId, relativePath }: { readonly taskId: string; readonly relativePath: string }) => ({ value: values.get(`${taskId}/${relativePath}`) }),
      writeText: async ({ taskId, relativePath, value }: { readonly taskId: string; readonly relativePath: string; readonly value: string }) => { values.set(`${taskId}/${relativePath}`, value); },
    } as never,
    tasks: {
      importVideo: async () => { calls.push("pick"); return localDetail.task; },
      start: async () => {
        calls.push("ingest");
        return { taskId: "task-local", completion: Promise.resolve(localDetail.task), cancel: async () => undefined };
      },
      getDetail: async () => localDetail,
      setAnalysisStatus: async (_taskId, status) => { calls.push(`analysis:${status}`); },
    },
    getProvider: async () => provider,
  });

  const record = await service.importVideo();
  assert.equal(record.taskId, "task-local");
  assert.equal(record.status, "succeeded");
  assert.deepEqual(calls, ["pick", "ingest", "analysis:running", "analysis:succeeded"]);
  assert.equal(record.result?.document.source && (record.result.document.source as { readonly platform?: string }).platform, "local_upload");
});
