import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { contentAnalysisResultSchema, type ContentAnalysisResultV1 } from "../packages/ai/src/index";
import { FileContentAnalysisStore } from "../packages/node-runtime/src/index";

const minimalResult: ContentAnalysisResultV1 = {
  schemaVersion: "content-analysis.v1",
  source: { taskId: "video-task", platform: "bilibili", contentType: "video", sourceKind: "asr" },
  overview: { summary: "摘要", theme: "主题", targetAudiences: ["受众"], communicationGoal: "目标" },
  hook: { type: "question", description: "开头", mechanism: "提问", evidenceRefs: ["segment-0"] },
  painPoints: [], emotionalDrivers: [],
  structure: [{ order: 1, role: "opening", summary: "开头", techniques: [], evidenceRefs: ["segment-0"] }],
  coreClaims: [],
  style: { tones: [], pacing: "平稳", languagePatterns: [], interactionMechanisms: [] },
  reusableTemplate: { formula: "开头-正文", steps: ["开头"], variableSlots: [], doNotCopy: [] },
  risks: [],
};

test("任务目录存储读取视频时间证据并保存拆解调试产物", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hongtai-analysis-store-"));
  const root = join(workspace, "tasks", "video-task");
  await mkdir(join(root, "transcript"), { recursive: true });
  await writeFile(join(root, "task.json"), JSON.stringify({ id: "video-task", platform: "bilibili", contentType: "video" }), "utf8");
  await writeFile(join(root, "metadata.json"), JSON.stringify({ platform: "bilibili", contentType: "video", title: "标题", author: "作者" }), "utf8");
  await writeFile(join(root, "transcript", "transcript.txt"), "第一段文字", "utf8");
  await writeFile(join(root, "transcript", "transcript.json"), JSON.stringify({ source: "asr", segments: [{ index: 0, startSeconds: 1, endSeconds: 3, text: "第一段文字", status: "succeeded" }] }), "utf8");
  try {
    const store = new FileContentAnalysisStore(workspace);
    const input = await store.loadInput("video-task");
    assert.deepEqual(input.evidenceUnits, [{ id: "segment-0", text: "第一段文字", startSeconds: 1, endSeconds: 3 }]);
    await store.saveResult("video-task", minimalResult, { id: "run-1", status: "succeeded", startedAt: "a", completedAt: "b", rawResponse: "data:image/png;base64,AAAA", reasoning: "拆解思考" });
    assert.equal(JSON.parse(await readFile(join(root, "analysis", "content-analysis.json"), "utf8")).schemaVersion, "content-analysis.v1");
    assert.doesNotMatch(await readFile(join(root, "analysis", "raw-response.json"), "utf8"), /AAAA/);
    assert.match(await readFile(join(root, "analysis", "reasoning.jsonl"), "utf8"), /拆解思考/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("任务目录存储把图文正文规范成段落证据", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hongtai-analysis-image-"));
  const root = join(workspace, "tasks", "image-task");
  await mkdir(join(root, "content"), { recursive: true });
  await writeFile(join(root, "task.json"), JSON.stringify({ id: "image-task", platform: "xiaohongshu", contentType: "image_text" }), "utf8");
  await writeFile(join(root, "metadata.json"), JSON.stringify({ platform: "xiaohongshu", contentType: "image_text" }), "utf8");
  await writeFile(join(root, "content", "content.txt"), "第一段\n\n第二段", "utf8");
  try {
    const input = await new FileContentAnalysisStore(workspace).loadInput("image-task");
    assert.equal(input.sourceKind, "image_text");
    assert.deepEqual(input.evidenceUnits.map((unit) => unit.id), ["paragraph-1", "paragraph-2"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("快手视频任务沿用统一内容拆解输入和结果Schema", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hongtai-analysis-kuaishou-"));
  const root = join(workspace, "tasks", "kuaishou-task");
  await mkdir(join(root, "transcript"), { recursive: true });
  await writeFile(join(root, "task.json"), JSON.stringify({ id: "kuaishou-task", platform: "kuaishou", contentType: "video" }), "utf8");
  await writeFile(join(root, "metadata.json"), JSON.stringify({ platform: "kuaishou", contentType: "video" }), "utf8");
  await writeFile(join(root, "transcript", "transcript.txt"), "快手视频文字", "utf8");
  await writeFile(join(root, "transcript", "transcript.json"), JSON.stringify({ source: "description", segments: [] }), "utf8");
  try {
    const input = await new FileContentAnalysisStore(workspace).loadInput("kuaishou-task");
    assert.equal(input.platform, "kuaishou");
    assert.equal(input.sourceKind, "description");
    const parsed = contentAnalysisResultSchema.safeParse({
      ...minimalResult,
      source: { ...minimalResult.source, taskId: "kuaishou-task", platform: "kuaishou" },
    });
    assert.equal(parsed.success, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
