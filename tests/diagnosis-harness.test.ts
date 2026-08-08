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
  async generate(request: AiGenerateRequest) {
    const content = request.output === "json" ? JSON.stringify(report) : "对话回复";
    await request.onEvent?.({ type: "reasoning_delta", delta: "测试reasoning" });
    await request.onEvent?.({ type: "content_delta", delta: content });
    await request.onEvent?.({ type: "completed" });
    return { content, reasoning: "测试reasoning" };
  }
  async transcribe(): Promise<string> { return ""; }
}

test("本地测试入口只绑定回环地址并保存标准图片、报告与reasoning", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-diagnosis-harness-"));
  const repository = new FileDiagnosisRepository(directory);
  const flow = new DiagnosisFlow({ provider: new HarnessProvider(), repository, contextWindowTokens: 32_000 });
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
    assert.equal(body.report.summary.headline, "测试报告");
    const root = join(directory, body.sessionId);
    const session = JSON.parse(await readFile(join(root, "session.json"), "utf8")) as { image?: unknown; imagePath?: unknown };
    assert.deepEqual(session.image, { mimeType: "image/jpeg" });
    assert.equal("imagePath" in session, false, "session metadata must not reveal the private image path");
    assert.equal((await readFile(join(root, "source", "normalized-image.jpg"))).subarray(0, 2).toString("hex"), "ffd8");
    assert.equal(JSON.parse(await readFile(join(root, "report.json"), "utf8")).schemaVersion, "diagnosis-report.v1");
    const runIds = await readdir(join(root, "runs"));
    const reasoning = await readFile(join(root, "runs", runIds[0]!, "reasoning.jsonl"), "utf8");
    assert.match(reasoning, /测试reasoning/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
