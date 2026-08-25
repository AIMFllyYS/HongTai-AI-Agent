import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DiagnosisFlow, type AiGenerateRequest, type AiProvider } from "../packages/ai/src/index";
import { FileDiagnosisRepository, SharpImagePreprocessor, createDiagnosisHarnessServer } from "../packages/node-runtime/src/index";

const report = {
  schemaVersion: "diagnosis-report.v1",
  mode: "tongue",
  promptVersion: "diagnosis-initial.v1",
  imageQuality: { usable: true, overallQuality: "good", limitations: [], retakeSuggestions: [] },
  summary: { headline: "测试报告", keyPoints: ["图片可用"], narrative: "仅作观察参考。" },
  observations: [],
  wellnessReferences: [],
  recommendations: [],
  safetyGuidance: { level: "none", reasons: [], recommendedAction: "如有不适请咨询专业人员" },
  followUpQuestions: ["近期作息如何？"],
  limitations: ["单图信息有限"],
  disclaimer: "不是疾病诊断，也不提供患病概率。",
} as const;

class HarnessProvider implements AiProvider {
  calls = 0;

  async generate(request: AiGenerateRequest) {
    this.calls += 1;
    const content = request.output === "json"
      ? JSON.stringify({
          quality: "good",
          qualityNote: "目标完整清晰。",
          observations: [
            { category: "tongue_body", region: "舌体", label: "舌色", description: "图片中的舌体颜色清晰可见。" },
            { category: "tongue_coating", region: "舌中", label: "舌苔", description: "舌中舌苔分布清晰可见。" },
            { category: "tongue_moisture", region: "舌面", label: "润泽", description: "舌面润泽状态清晰可见。" },
          ],
          summary: report.summary.narrative,
          wellnessReferences: [{ title: "传统观察参考", statement: "传统观察中，这组特征可能作为日常记录线索。" }],
          advice: "保持相近光线继续记录。",
          safety: report.safetyGuidance.recommendedAction,
          followUp: report.followUpQuestions[0],
        })
      : "对话回复";
    await request.onEvent?.({ type: "reasoning_delta", delta: "测试reasoning" });
    await request.onEvent?.({ type: "content_delta", delta: content });
    await request.onEvent?.({ type: "completed" });
    return { content, reasoning: "测试reasoning" };
  }
  async transcribe(): Promise<string> { return ""; }
}

test("本地测试入口只绑定回环地址并保存标准图片、报告且不持久化reasoning", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-diagnosis-harness-"));
  const repository = new FileDiagnosisRepository(directory);
  const provider = new HarnessProvider();
  const flow = new DiagnosisFlow({ provider, repository, contextWindowTokens: 32_000 });
  const server = createDiagnosisHarnessServer({ flow, preprocessor: new SharpImagePreprocessor() });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    assert.equal(address.address, "127.0.0.1");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const response = await fetch(`http://127.0.0.1:${address.port}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "tongue", imageDataUrl: `data:image/png;base64,${png}` }),
    });
    assert.equal(response.status, 201);
    const body = await response.json() as { sessionId: string; report: { summary: { headline: string } } };
    assert.equal(body.report.summary.headline, "舌色");
    assert.equal(provider.calls, 1);
    const root = join(directory, body.sessionId);
    const session = JSON.parse(await readFile(join(root, "session.json"), "utf8")) as { image?: unknown; imagePath?: unknown };
    assert.deepEqual(session.image, { mimeType: "image/jpeg" });
    assert.equal("imagePath" in session, false, "session metadata must not reveal the private image path");
    assert.equal((await readFile(join(root, "source", "normalized-image.jpg"))).subarray(0, 2).toString("hex"), "ffd8");
    assert.equal(JSON.parse(await readFile(join(root, "report.json"), "utf8")).schemaVersion, "diagnosis-report.v1");
    const runIds = await readdir(join(root, "runs"));
    const reasoning = await readFile(join(root, "runs", runIds[0]!, "reasoning.jsonl"), "utf8");
    assert.equal(reasoning, "");
    const rawResponse = JSON.parse(await readFile(join(root, "runs", runIds[0]!, "raw-response.json"), "utf8")) as { content: string };
    assert.equal(rawResponse.content, "");
    await repository.saveRun(body.sessionId, {
      id: "storage-boundary",
      kind: "diagnosis",
      status: "succeeded",
      startedAt: "a",
      completedAt: "b",
      rawResponse: "data:image/png;base64,AAAA",
      reasoning: "不应落盘的推理链",
    });
    assert.deepEqual(
      JSON.parse(await readFile(join(root, "runs", "storage-boundary", "raw-response.json"), "utf8")),
      { content: "" },
    );
    assert.equal(await readFile(join(root, "runs", "storage-boundary", "reasoning.jsonl"), "utf8"), "");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("本地观察测试页不把用户或模型文本交给HTML注入sink", async () => {
  const source = await readFile(join(process.cwd(), "packages", "node-runtime", "src", "ai", "diagnosis-harness-server.ts"), "utf8");
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML/u);
  assert.match(source, /textContent/u);
});

test("损坏与超限图片返回稳定HTTP错误且不创建会话或调用Provider", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-diagnosis-harness-errors-"));
  const repository = new FileDiagnosisRepository(directory);
  const provider = new HarnessProvider();
  const flow = new DiagnosisFlow({ provider, repository, contextWindowTokens: 32_000 });
  const server = createDiagnosisHarnessServer({ flow, preprocessor: new SharpImagePreprocessor() });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const endpoint = `http://127.0.0.1:${address.port}/api/sessions`;
    const postImage = (imageDataUrl: string) => fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "tongue", imageDataUrl }),
    });

    const before = await readdir(directory);
    const malformed = await postImage("data:image/jpeg;base64,/9j/");
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json() as { code: string }).code, "IMAGE_INVALID");
    assert.deepEqual(await readdir(directory), before);
    assert.equal(provider.calls, 0);

    const oversized = Buffer.alloc(15 * 1024 * 1024 + 1).toString("base64");
    const tooLarge = await postImage(`data:image/jpeg;base64,${oversized}`);
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json() as { code: string }).code, "IMAGE_TOO_LARGE");
    assert.deepEqual(await readdir(directory), before);
    assert.equal(provider.calls, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
