import assert from "node:assert/strict";
import test from "node:test";

import type { AiProvider } from "@hongtai/ai";
import type { TaskDetailRecord } from "@hongtai/core";

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
  assert.match(JSON.stringify(events), /内容概览/);
  assert.doesNotMatch(JSON.stringify(events), /internal reasoning|真实转写证据/);
});

test("StandaloneAnalysisService automatically runs ingest then formal analysis for a picked local video", async () => {
  const calls: string[] = [];
  const localResult = { ...result, source: { taskId: "task-local", platform: "local_upload", contentType: "video", sourceKind: "asr" } } as const;
  const provider: AiProvider = {
    generate: async () => ({ content: JSON.stringify(localResult), reasoning: "must not persist" }),
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
