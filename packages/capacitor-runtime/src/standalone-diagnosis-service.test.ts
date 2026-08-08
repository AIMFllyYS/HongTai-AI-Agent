import assert from "node:assert/strict";
import test from "node:test";

import type { AiProvider } from "@hongtai/ai";
import { TaskError } from "@hongtai/core";

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

test("StandaloneDiagnosisService saves a formal report and real follow-up history without exposing private image URIs", async () => {
  const native = memoryFiles();
  let calls = 0;
  const provider: AiProvider = {
    generate: async (request) => {
      calls += 1;
      const content = calls === 1 ? JSON.stringify(report) : "建议保持相近光线，持续记录变化。";
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
  const savedReport = await service.runReport(session.sessionId);
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
  assert.equal((await service.listMessages(session.sessionId)).length, 2);
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
