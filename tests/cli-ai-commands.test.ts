import assert from "node:assert/strict";
import test from "node:test";
import { parseContentAnalysisOptions, parseDiagnosisServeOptions } from "../apps/cli/src/ai-command-options";

test("diagnosis serve使用默认端口并校验自定义端口", () => {
  assert.deepEqual(parseDiagnosisServeOptions([]), { port: 4317 });
  assert.deepEqual(parseDiagnosisServeOptions(["--port", "5001"]), { port: 5001 });
  assert.throws(() => parseDiagnosisServeOptions(["--port", "0"]), /端口/);
  assert.throws(() => parseDiagnosisServeOptions(["--unknown"]), /未知参数/);
});

test("analyze-content只接受一个安全任务ID", () => {
  assert.deepEqual(parseContentAnalysisOptions(["20260805-abcd"]), { taskId: "20260805-abcd" });
  assert.throws(() => parseContentAnalysisOptions([]), /任务ID/);
  assert.throws(() => parseContentAnalysisOptions(["../other"]), /任务ID/);
  assert.throws(() => parseContentAnalysisOptions(["one", "two"]), /参数/);
});
