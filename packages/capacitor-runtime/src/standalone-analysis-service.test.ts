import assert from "node:assert/strict";
import test from "node:test";

import type { AiProvider } from "@hongtai/ai";
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
      await request.onEvent?.({ type: "content_delta", delta: JSON.stringify(result) });
      await request.onEvent?.({ type: "completed" });
      return { content: JSON.stringify(result), reasoning: "internal reasoning" };
    },
    transcribe: async () => "",
  };
  const service = new StandaloneAnalysisService({
    files: {
      readText: async ({ taskId, relativePath }: { readonly taskId: string; readonly relativePath: string }) => ({ value: values.get(`${taskId}/${relativePath}`) }),
      writeText: async ({ taskId, relativePath, value }: { readonly taskId: string; readonly relativePath: string; readonly value: string }) => { values.set(`${taskId}/${relativePath}`, value); },
    } as never,
    tasks: {
      getDetail: async () => detail(),
      setAnalysisStatus: async (_taskId, status) => { statuses.push(status); },
    },
    getProvider: async () => provider,
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  });

  const record = await service.run("task-1");

  assert.equal(record.status, "succeeded");
  assert.equal(record.result?.schemaVersion, "content-analysis.v1");
  assert.deepEqual(statuses, ["running", "succeeded"]);
  assert.doesNotMatch(values.get("task-1/analysis.json") ?? "", /internal reasoning|rawResponse/);
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
      getDetail: async () => detail(),
      setAnalysisStatus: async () => undefined,
    },
    getProvider: async () => ({
      generate: async () => {
        entered.resolve();
        await release.promise;
        return { content: JSON.stringify(result), reasoning: "" };
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
