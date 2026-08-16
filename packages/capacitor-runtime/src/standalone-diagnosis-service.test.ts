import assert from "node:assert/strict";
import test from "node:test";

import type { AiGenerateRequest, AiProvider } from "@hongtai/ai";
import { TaskError } from "@hongtai/core";

import { RuntimeOperationRegistry } from "./runtime-operation-registry.js";
import { StandaloneDiagnosisService } from "./standalone-diagnosis-service.js";

const report = {
  schemaVersion: "diagnosis-report.v1",
  mode: "tongue",
  promptVersion: "diagnosis-initial.v1",
  imageQuality: { usable: true, overallQuality: "good", limitations: [], retakeSuggestions: [] },
  summary: { headline: "图片清晰可观察", keyPoints: ["可见区域清晰"], narrative: "仅提供日常观察参考。" },
  observations: [{ id: "obs-1", category: "tongue_body", region: "舌体", label: "可见颜色", description: "颜色较均匀", visibility: "clear", evidenceDescription: "中央区域清晰" }],
  wellnessReferences: [{ title: "日常参考", basisObservationIds: ["obs-1"], statement: "可在相近光线下继续记录", certainty: "possible", notADiagnosis: true }],
  recommendations: [{ category: "monitoring", priority: "low", title: "保持记录", action: "在相近光线下观察", rationale: "便于比较变化", relatedObservationIds: ["obs-1"] }],
  safetyGuidance: { level: "none", reasons: [], recommendedAction: "如有持续不适请咨询专业人员" },
  followUpQuestions: ["怎样在相近光线下记录？"],
  limitations: ["单张图片不能替代专业检查"],
  disclaimer: "本报告不是疾病诊断，也不提供患病概率。",
} as const;

function diagnosisModuleContent(request: AiGenerateRequest): string {
  if (request.jsonSchema?.name !== "diagnosis_single_response_v2") {
    throw new Error(`unexpected diagnosis schema: ${request.jsonSchema?.name ?? "none"}`);
  }
  return JSON.stringify({
    quality: "good",
    qualityNote: "目标完整、对焦清晰，颜色与形态基本可辨。",
    observations: [
      { category: "tongue_body", region: "舌体", label: "舌色", description: "舌体整体颜色较均匀。" },
      { category: "tongue_coating", region: "舌中", label: "舌苔", description: "舌中可见薄白苔，分布较均匀。" },
      { category: "tongue_moisture", region: "舌面", label: "润泽", description: "舌面可见轻度润泽感。" },
    ],
    summary: "本次图片可用于日常可见状态记录，不代表疾病诊断。",
    wellnessReferences: [{ title: "传统望诊参考", statement: "传统观察中，这组可见特征可能作为日常状态记录线索。" }],
    advice: "保持相同光线和角度定期记录，并结合近期作息观察变化。",
    safety: "单张图片不能替代专业检查；如有持续不适，请咨询专业人员。",
    followUp: "最近作息是否规律？",
  });
}

function memoryFiles() {
  const values = new Map<string, string>();
  const ids = new Set<string>();
  const key = (sessionId: string, relativePath: string) => `${sessionId}/${relativePath}`;
  return {
    values,
    plugin: {
      ensureObservation: async ({ sessionId }: { readonly sessionId: string }) => { ids.add(sessionId); },
      writeObservationText: async ({ sessionId, relativePath, value }: { readonly sessionId: string; readonly relativePath: string; readonly value: string; readonly replace: boolean }) => { values.set(key(sessionId, relativePath), value); },
      readObservationText: async ({ sessionId, relativePath }: { readonly sessionId: string; readonly relativePath: string }) => ({ value: values.get(key(sessionId, relativePath)) }),
      listObservationIds: async () => ({ sessionIds: [...ids] }),
      copyToObservation: async ({ sessionId, relativePath }: { readonly sessionId: string; readonly sourceUri: string; readonly relativePath: string }) => ({
        uri: `file:///private/observations/${sessionId}/${relativePath}`, sizeBytes: 128, mimeType: "image/jpeg",
      }),
      getObservationUri: async ({ sessionId, relativePath }: { readonly sessionId: string; readonly relativePath: string }) => ({
        uri: ids.has(sessionId) ? `file:///private/observations/${sessionId}/${relativePath}` : undefined, sizeBytes: 128, mimeType: "image/jpeg",
      }),
    },
  };
}

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve };
}

test("StandaloneDiagnosisService saves a formal report and real follow-up history without exposing private image URIs", async () => {
  const native = memoryFiles();
  const provider: AiProvider = {
    generate: async (request) => {
      const content = request.output === "json"
        ? diagnosisModuleContent(request)
        : "建议保持相近光线，持续记录变化。";
      await request.onEvent?.({ type: "reasoning_delta", delta: "private reasoning" });
      await request.onEvent?.({ type: "content_delta", delta: content });
      await request.onEvent?.({ type: "completed" });
      return { content, reasoning: "private reasoning" };
    },
    transcribe: async () => "",
  };
  const service = new StandaloneDiagnosisService({
    files: native.plugin,
    fileMedia: {
      pickPhoto: async () => ({ uri: "file:///private/media/imported.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      capturePhoto: async () => ({ uri: "file:///private/media/captured.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      consumePhotoOperation: async () => ({ status: "none" }),
    },
    getProvider: async () => provider,
    toDisplayUri: (value) => `capacitor://localhost/observation/${encodeURIComponent(value)}`,
    createSessionId: () => "session-1",
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  });

  const image = await service.pickImage();
  const session = await service.createSession({ mode: "tongue", image });
  const reportEvents: unknown[] = [];
  const savedReport = await service.runReport(session.sessionId, async (event) => { reportEvents.push(event); });
  const streamed: string[] = [];
  const answer = await service.followUp(session.sessionId, "怎样继续记录？", async (event) => {
    if (event.type === "content_delta") streamed.push(event.delta);
  });

  assert.equal(savedReport.status, "succeeded");
  assert.equal(savedReport.report?.schemaVersion, "diagnosis-report.v1");
  assert.equal(answer.content, "建议保持相近光线，持续记录变化。");
  assert.deepEqual(streamed, ["建议保持相近光线，持续记录变化。"]);
  assert.doesNotMatch(JSON.stringify(session), /file:\/\//);
  assert.doesNotMatch(JSON.stringify(savedReport), /private reasoning|file:\/\//);
  const progressEvents = reportEvents.filter((event) => (event as { readonly type?: string }).type === "progress");
  assert.match(JSON.stringify(progressEvents), /"moduleId":"visual-observations"/);
  assert.match(JSON.stringify(progressEvents), /颜色较均匀/);
  assert.match(JSON.stringify(progressEvents), /private reasoning/);
  assert.doesNotMatch(JSON.stringify(progressEvents), /file:\/\//);
  assert.equal((await service.listMessages(session.sessionId)).length, 2);
});

test("StandaloneDiagnosisService distinguishes external photo work from in-process AI work", async () => {
  const native = memoryFiles();
  const pickEntered = deferred();
  const pickRelease = deferred();
  const reportEntered = deferred();
  const reportRelease = deferred();
  const followUpEntered = deferred();
  const followUpRelease = deferred();
  const operations = new RuntimeOperationRegistry();
  let calls = 0;
  const service = new StandaloneDiagnosisService({
    files: native.plugin,
    fileMedia: {
      pickPhoto: async () => {
        pickEntered.resolve();
        await pickRelease.promise;
        return { uri: "file:///private/media/imported.jpg", mimeType: "image/jpeg", sizeBytes: 128 };
      },
      capturePhoto: async () => ({ uri: "file:///private/media/captured.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      consumePhotoOperation: async () => ({ status: "none" }),
    },
    getProvider: async () => ({
      generate: async (request) => {
        calls += 1;
        if (calls === 1) {
          reportEntered.resolve();
          await reportRelease.promise;
        }
        if (request.output === "json") {
          return { content: diagnosisModuleContent(request), reasoning: "" };
        }
        followUpEntered.resolve();
        await followUpRelease.promise;
        return { content: "继续保持同一光线记录。", reasoning: "" };
      },
      transcribe: async () => "",
    }),
    toDisplayUri: (value) => `capacitor://localhost/observation/${encodeURIComponent(value)}`,
    createSessionId: () => "session-ops",
    operations,
  });

  const picking = service.pickImage();
  await pickEntered.promise;
  assert.deepEqual(operations.list(), [{ kind: "transient-operation", id: "diagnosis-photo", source: "memory", execution: "external-activity" }]);
  pickRelease.resolve();
  const image = await picking;
  assert.deepEqual(operations.list(), []);

  const session = await service.createSession({ mode: "tongue", image });
  const reporting = service.runReport(session.sessionId);
  await reportEntered.promise;
  assert.deepEqual(operations.list(), [{ kind: "diagnosis-report", id: "session-ops", source: "memory", execution: "in-process" }]);
  reportRelease.resolve();
  await reporting;
  assert.deepEqual(operations.list(), []);

  const followingUp = service.followUp(session.sessionId, "如何继续记录？");
  await followUpEntered.promise;
  assert.deepEqual(operations.list(), [{ kind: "transient-operation", id: "diagnosis-follow-up:session-ops", source: "memory", execution: "in-process" }]);
  followUpRelease.resolve();
  await followingUp;
  assert.deepEqual(operations.list(), []);
});

test("StandaloneDiagnosisService queues two same-session follow-ups so both rounds survive restart", async () => {
  const native = memoryFiles();
  const firstEntered = deferred();
  const firstRelease = deferred();
  let textCalls = 0;
  const answers = new Map([
    ["第一轮追问", "第一轮回复"],
    ["第二轮追问", "第二轮回复"],
  ]);
  const lastUserQuestion = (request: AiGenerateRequest): string => {
    const lastUser = [...request.messages].reverse().find((message) => message.role === "user");
    return typeof lastUser?.content === "string" ? lastUser.content : "";
  };
  const createService = () => new StandaloneDiagnosisService({
    files: native.plugin,
    fileMedia: {
      pickPhoto: async () => ({ uri: "file:///private/media/imported.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      capturePhoto: async () => ({ uri: "file:///private/media/captured.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      consumePhotoOperation: async () => ({ status: "none" }),
    },
    getProvider: async () => ({
      generate: async (request) => {
        if (request.output === "json") return { content: diagnosisModuleContent(request), reasoning: "" };
        textCalls += 1;
        if (textCalls === 1) {
          firstEntered.resolve();
          await firstRelease.promise;
        }
        return { content: answers.get(lastUserQuestion(request)) ?? "未匹配回复", reasoning: "" };
      },
      transcribe: async () => "",
    }),
    toDisplayUri: (value) => value,
    createSessionId: () => "session-follow-up-queue",
  });

  const service = createService();
  const image = await service.pickImage();
  const session = await service.createSession({ mode: "tongue", image });
  await service.runReport(session.sessionId);

  const first = service.followUp(session.sessionId, "第一轮追问");
  const second = service.followUp(session.sessionId, "第二轮追问");
  await firstEntered.promise;
  assert.notStrictEqual(second, first);
  assert.equal(textCalls, 1, "the second follow-up must wait for the first chat and persist to finish");

  firstRelease.resolve();
  const [firstAnswer, secondAnswer] = await Promise.all([first, second]);
  assert.equal(firstAnswer.content, "第一轮回复");
  assert.equal(secondAnswer.content, "第二轮回复");
  assert.equal(textCalls, 2);

  const expectedRounds = [
    { role: "user", content: "第一轮追问" },
    { role: "assistant", content: "第一轮回复" },
    { role: "user", content: "第二轮追问" },
    { role: "assistant", content: "第二轮回复" },
  ] as const;
  assert.deepEqual((await service.listMessages(session.sessionId)).map(({ role, content }) => ({ role, content })), [...expectedRounds]);

  const restarted = createService();
  assert.deepEqual((await restarted.listMessages(session.sessionId)).map(({ role, content }) => ({ role, content })), [...expectedRounds]);
});

test("StandaloneDiagnosisService single-flights report generation and replays runtime-only reasoning", async () => {
  const native = memoryFiles();
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  const service = new StandaloneDiagnosisService({
    files: native.plugin,
    fileMedia: {
      pickPhoto: async () => ({ uri: "file:///private/media/imported.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      capturePhoto: async () => ({ uri: "file:///private/media/captured.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      consumePhotoOperation: async () => ({ status: "none" }),
    },
    getProvider: async () => ({
      generate: async (request) => {
        calls += 1;
        if (calls === 1) {
          await request.onEvent?.({ type: "reasoning_delta", delta: "late diagnosis reasoning" });
          entered.resolve();
          await release.promise;
        }
        const content = diagnosisModuleContent(request);
        await request.onEvent?.({ type: "content_delta", delta: content });
        await request.onEvent?.({ type: "completed" });
        return { content, reasoning: "late diagnosis reasoning" };
      },
      transcribe: async () => "",
    }),
    toDisplayUri: (value) => `capacitor://localhost/observation/${encodeURIComponent(value)}`,
    createSessionId: () => "session-single-flight",
  });
  const image = await service.pickImage();
  const session = await service.createSession({ mode: "tongue", image });
  const first = service.runReport(session.sessionId);
  await entered.promise;
  const lateEvents: import("@hongtai/core").DiagnosisReportStreamEvent[] = [];
  service.subscribeReport(session.sessionId, async (event) => {
    lateEvents.push(event);
    if (event.type === "completed") {
      assert.equal((await service.getReport(session.sessionId))?.status, "succeeded");
    }
  });
  const second = service.runReport(session.sessionId);

  assert.strictEqual(second, first);
  assert.equal(lateEvents[0]?.type, "progress");
  if (lateEvents[0]?.type === "progress") {
    assert.equal(lateEvents[0].sessionId, session.sessionId);
    assert.equal(lateEvents[0].progress.modules[0]?.moduleId, "visual-observations");
    assert.equal(lateEvents[0].progress.modules[0]?.status, "running");
    assert.deepEqual(lateEvents[0].progress.thinking, {
      status: "streaming",
      text: "late diagnosis reasoning",
    });
  }

  release.resolve();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(lateEvents.at(-1)?.type, "completed");
  assert.doesNotMatch(JSON.stringify([...native.values.values()]), /late diagnosis reasoning|"thinking"/);
  const afterCompletion: import("@hongtai/core").DiagnosisReportStreamEvent[] = [];
  const unsubscribeAfterCompletion = service.subscribeReport(session.sessionId, (event) => { afterCompletion.push(event); });
  assert.deepEqual(afterCompletion, [], "terminal runs must clear their runtime-only snapshot");
  unsubscribeAfterCompletion();
});

test("StandaloneDiagnosisService never lets a slow report listener stall the formal flow", { timeout: 1_000 }, async () => {
  const native = memoryFiles();
  const providerEntered = deferred();
  const neverSettles = new Promise<void>(() => undefined);
  const service = new StandaloneDiagnosisService({
    files: native.plugin,
    fileMedia: {
      pickPhoto: async () => ({ uri: "file:///private/media/imported.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      capturePhoto: async () => ({ uri: "file:///private/media/captured.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      consumePhotoOperation: async () => ({ status: "none" }),
    },
    getProvider: async () => ({
      generate: async (request) => {
        providerEntered.resolve();
        return { content: diagnosisModuleContent(request), reasoning: "" };
      },
      transcribe: async () => "",
    }),
    toDisplayUri: (value) => value,
    createSessionId: () => "session-slow-listener",
  });
  const image = await service.pickImage();
  const session = await service.createSession({ mode: "tongue", image });
  const unsubscribe = service.subscribeReport(session.sessionId, () => neverSettles);
  const running = service.runReport(session.sessionId);

  await providerEntered.promise;
  unsubscribe();

  assert.equal((await running).status, "succeeded");
});

test("StandaloneDiagnosisService keeps three validated modules on module-four failure without a formal report", async () => {
  const native = memoryFiles();
  const schemas: string[] = [];
  let safetyAttempts = 0;
  const service = new StandaloneDiagnosisService({
    files: native.plugin,
    fileMedia: {
      pickPhoto: async () => ({ uri: "file:///private/media/imported.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      capturePhoto: async () => ({ uri: "file:///private/media/captured.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      consumePhotoOperation: async () => ({ status: "none" }),
    },
    getProvider: async () => ({
      generate: async (request) => {
        const schema = request.jsonSchema?.name ?? "none";
        schemas.push(schema);
        let content = diagnosisModuleContent(request);
        if (safetyAttempts++ < 2) {
          const invalid = JSON.parse(content) as { safety: unknown };
          invalid.safety = "";
          content = JSON.stringify(invalid);
        }
        await request.onEvent?.({ type: "content_delta", delta: content });
        await request.onEvent?.({ type: "completed" });
        return { content, reasoning: "" };
      },
      transcribe: async () => "",
    }),
    toDisplayUri: (value) => value,
    createSessionId: () => "session-module-four-failure",
  });
  const image = await service.pickImage();
  const session = await service.createSession({ mode: "tongue", image });
  const events: import("@hongtai/core").DiagnosisReportStreamEvent[] = [];

  await assert.rejects(() => service.runReport(session.sessionId, (event) => { events.push(event); }));

  const failed = events.at(-1);
  assert.equal(failed?.type, "failed");
  if (failed?.type === "failed") {
    assert.equal(failed.failedModuleId, "safety-limitations");
    assert.deepEqual(failed.progress.modules.map(({ moduleId, status }) => ({ moduleId, status })), [
      { moduleId: "visual-observations", status: "succeeded" },
      { moduleId: "observation-summary", status: "succeeded" },
      { moduleId: "wellness-recommendations", status: "succeeded" },
      { moduleId: "safety-limitations", status: "failed" },
      { moduleId: "follow-up-questions", status: "pending" },
    ]);
  }
  assert.equal(native.values.has(`${session.sessionId}/report.json`), false);
  assert.equal((await service.getReport(session.sessionId))?.status, "failed");
  assert.deepEqual(schemas.slice(0, 2), [
    "diagnosis_single_response_v2",
    "diagnosis_single_response_v2",
  ]);

  assert.equal((await service.runReport(session.sessionId)).status, "succeeded");
  assert.equal(schemas[2], "diagnosis_single_response_v2");
});

test("StandaloneDiagnosisService keeps the selected image MIME across private copy and reload", async () => {
  const values = new Map<string, string>();
  let copiedPath = "";
  const service = new StandaloneDiagnosisService({
    files: {
      ensureObservation: async () => undefined,
      writeObservationText: async ({ relativePath, value }) => { values.set(relativePath, value); },
      readObservationText: async ({ relativePath }) => ({ value: values.get(relativePath) }),
      listObservationIds: async () => ({ sessionIds: ["session-png"] }),
      copyToObservation: async ({ relativePath }) => {
        copiedPath = relativePath;
        return { uri: `file:///private/observations/session-png/${relativePath}`, sizeBytes: 256, mimeType: "application/octet-stream" };
      },
      getObservationUri: async ({ relativePath }) => ({
        uri: `file:///private/observations/session-png/${relativePath}`,
        sizeBytes: 256,
        mimeType: "application/octet-stream",
      }),
    },
    fileMedia: {
      pickPhoto: async () => ({ uri: "file:///private/media/imported.png", mimeType: "image/png", sizeBytes: 256 }),
      capturePhoto: async () => ({ uri: "file:///private/media/captured.jpg", mimeType: "image/jpeg", sizeBytes: 256 }),
      consumePhotoOperation: async () => ({ status: "none" }),
    },
    getProvider: async () => ({ generate: async () => ({ content: "", reasoning: "" }), transcribe: async () => "" }),
    toDisplayUri: (value) => `capacitor://localhost/observation/${encodeURIComponent(value)}`,
    createSessionId: () => "session-png",
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  });

  const selected = await service.pickImage();
  const created = await service.createSession({ mode: "tongue", image: selected });
  const reloaded = await service.getSession(created.sessionId);

  assert.equal(copiedPath, "image.png");
  assert.equal(created.image.mimeType, "image/png");
  assert.equal(reloaded?.image.mimeType, "image/png");
});

test("StandaloneDiagnosisService maps native image rejection before creating a session", async () => {
  const native = memoryFiles();
  const service = new StandaloneDiagnosisService({
    files: native.plugin,
    fileMedia: {
      pickPhoto: async () => { throw { code: "ERR_IMAGE_TOO_LARGE", message: "private native detail" }; },
      capturePhoto: async () => { throw { code: "ERR_IMAGE_INVALID", message: "private native detail" }; },
      consumePhotoOperation: async () => ({ status: "none" }),
    },
    getProvider: async () => ({ generate: async () => ({ content: "", reasoning: "" }), transcribe: async () => "" }),
    toDisplayUri: (value) => value,
  });

  await assert.rejects(
    () => service.pickImage(),
    (error) => error instanceof TaskError && error.code === "IMAGE_TOO_LARGE" && error.message === "图片不能超过15MB",
  );
  await assert.rejects(
    () => service.captureImage(),
    (error) => error instanceof TaskError && error.code === "IMAGE_INVALID" && error.message === "无法读取或规范化图片",
  );
  assert.equal((await native.plugin.listObservationIds()).sessionIds.length, 0);
});

test("StandaloneDiagnosisService persists report failure and still rejects the original error", async () => {
  const native = memoryFiles();
  const failure = new TaskError({
    code: "AI_NETWORK_FAILED",
    message: "无法连接AI服务",
    retryable: true,
    action: "check_network",
    cause: { code: "ERR_AI_NETWORK_FAILED" },
  });
  const service = new StandaloneDiagnosisService({
    files: native.plugin,
    fileMedia: {
      pickPhoto: async () => ({ uri: "file:///private/media/imported.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      capturePhoto: async () => ({ uri: "file:///private/media/captured.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      consumePhotoOperation: async () => ({ status: "none" }),
    },
    getProvider: async () => ({ generate: async () => { throw failure; }, transcribe: async () => "" }),
    toDisplayUri: (value) => value,
    createSessionId: () => "session-failed",
    now: () => new Date("2026-08-08T00:00:00.000Z"),
  });

  const image = await service.pickImage();
  const session = await service.createSession({ mode: "tongue", image });
  await assert.rejects(() => service.runReport(session.sessionId), (error) => error === failure);

  const failed = await service.getReport(session.sessionId);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.issue?.code, "AI_NETWORK_FAILED");
  assert.equal(failed?.issue?.details?.nativeCode, "ERR_AI_NETWORK_FAILED");
});

test("StandaloneDiagnosisService consumes a recovered native photo as a safe MediaReference", async () => {
  const native = memoryFiles();
  const service = new StandaloneDiagnosisService({
    files: native.plugin,
    fileMedia: {
      pickPhoto: async () => ({ uri: "file:///private/media/imported.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      capturePhoto: async () => ({ uri: "file:///private/media/captured.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      consumePhotoOperation: async () => ({
        status: "succeeded" as const,
        origin: "captured" as const,
        uri: "file:///private/media/recovered.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 512,
      }),
    },
    getProvider: async () => ({ generate: async () => ({ content: "", reasoning: "" }), transcribe: async () => "" }),
    toDisplayUri: (value) => `capacitor://localhost/observation/${encodeURIComponent(value)}`,
  });

  const recovered = await service.consumeImageRecovery();

  assert.equal(recovered.status, "succeeded");
  if (recovered.status !== "succeeded") assert.fail("expected a recovered image");
  assert.equal(recovered.image.origin, "captured");
  assert.equal(recovered.image.mimeType, "image/jpeg");
  assert.equal(recovered.image.byteLength, 512);
  assert.doesNotMatch(JSON.stringify(recovered), /file:\/\//);
});

test("StandaloneDiagnosisService maps every recovered native photo terminal to a stable TaskIssue", async () => {
  const expected = new Map<string, string>([
    ["ERR_MEDIA_SELECTION_CANCELLED", "MEDIA_SELECTION_CANCELLED"],
    ["ERR_MEDIA_SOURCE_MISSING", "MEDIA_SOURCE_NOT_FOUND"],
    ["ERR_PHOTO_CAPTURE_LOST", "TASK_INTERRUPTED"],
    ["ERR_PHOTO_RECOVERY_FAILED", "TASK_INTERRUPTED"],
    ["ERR_MEDIA_READ_FAILED", "MEDIA_READ_FAILED"],
    ["ERR_PRIVATE_FILE_IMPORT_FAILED", "MEDIA_IMPORT_FAILED"],
    ["ERR_IMAGE_TOO_LARGE", "IMAGE_TOO_LARGE"],
    ["ERR_IMAGE_INVALID", "IMAGE_INVALID"],
  ]);

  for (const [nativeCode, taskCode] of expected) {
    const native = memoryFiles();
    const service = new StandaloneDiagnosisService({
      files: native.plugin,
      fileMedia: {
        pickPhoto: async () => ({ uri: "file:///private/media/imported.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
        capturePhoto: async () => ({ uri: "file:///private/media/captured.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
        consumePhotoOperation: async () => ({ status: "failed" as const, code: nativeCode }),
      },
      getProvider: async () => ({ generate: async () => ({ content: "", reasoning: "" }), transcribe: async () => "" }),
      toDisplayUri: (value) => value,
    });

    const recovered = await service.consumeImageRecovery();

    assert.equal(recovered.status, "failed", nativeCode);
    if (recovered.status !== "failed") assert.fail(`expected ${nativeCode} to fail`);
    assert.equal(recovered.issue.code, taskCode, nativeCode);
    assert.equal(recovered.issue.action, "select_media", nativeCode);
    assert.equal(recovered.issue.details?.nativeCode, nativeCode);
  }
});

test("StandaloneDiagnosisService maps cancellation from a live picker call without creating a session", async () => {
  const native = memoryFiles();
  const service = new StandaloneDiagnosisService({
    files: native.plugin,
    fileMedia: {
      pickPhoto: async () => { throw { code: "ERR_MEDIA_SELECTION_CANCELLED" }; },
      capturePhoto: async () => ({ uri: "file:///private/media/captured.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      consumePhotoOperation: async () => ({ status: "none" as const }),
    },
    getProvider: async () => ({ generate: async () => ({ content: "", reasoning: "" }), transcribe: async () => "" }),
    toDisplayUri: (value) => value,
  });

  await assert.rejects(
    () => service.pickImage(),
    (error) => error instanceof TaskError && error.code === "MEDIA_SELECTION_CANCELLED" && error.action === "select_media",
  );
  assert.equal((await native.plugin.listObservationIds()).sessionIds.length, 0);
});

test("StandaloneDiagnosisService recovers a running report without losing its private image projection", async () => {
  const native = memoryFiles();
  const options = {
    files: native.plugin,
    fileMedia: {
      pickPhoto: async () => ({ uri: "file:///private/media/imported.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      capturePhoto: async () => ({ uri: "file:///private/media/captured.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      consumePhotoOperation: async () => ({ status: "none" as const }),
    },
    getProvider: async () => ({ generate: async () => ({ content: JSON.stringify(report), reasoning: "" }), transcribe: async () => "" }),
    toDisplayUri: (value: string) => `capacitor://localhost/observation/${encodeURIComponent(value)}`,
    createSessionId: () => "session-interrupted",
    now: () => new Date("2026-08-12T01:02:03.000Z"),
  };
  const service = new StandaloneDiagnosisService(options);
  const image = await service.pickImage();
  await service.createSession({ mode: "tongue", image });
  const stored = JSON.parse(native.values.get("session-interrupted/session.json") ?? "{}") as Record<string, unknown>;
  native.values.set("session-interrupted/session.json", JSON.stringify({ ...stored, reportStatus: "running" }));

  assert.deepEqual(await service.inspectUnfinishedWork(), [{
    kind: "diagnosis-report",
    id: "session-interrupted",
    source: "persisted",
    execution: "in-process",
  }]);
  assert.equal((await service.recoverInterruptedWork()).length, 1);
  assert.equal((await service.recoverInterruptedWork()).length, 0);

  const recovered = await service.getReport("session-interrupted");
  assert.equal(recovered?.status, "failed");
  assert.equal(recovered?.issue?.code, "TASK_INTERRUPTED");
  assert.equal(recovered?.issue?.action, "retry");
  assert.equal((await service.getSession("session-interrupted"))?.image.mimeType, "image/jpeg");
});
