import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const architecture = readFileSync(new URL("../docs/架构与工程规范.md", import.meta.url), "utf8");

test("minimum APK contract keeps shared flows as the sole task executor", () => {
  assert.match(architecture, /IngestPipeline.*唯一.*任务执行器/u);
  assert.match(architecture, /ContentAnalysisFlow.*DiagnosisFlow.*唯一.*业务/u);
});

test("minimum APK contract uses private task files instead of a SQLCipher task schema", () => {
  assert.match(architecture, /tasks\/<taskId>\/task\.json/u);
  assert.match(architecture, /首版不实现 SQLCipher.*任务/u);
});

test("minimum APK contract limits Android work to explicit I/O ports", () => {
  assert.match(architecture, /SecureSettings.*LocalFiles.*NativeHttp.*MediaTools/us);
  assert.match(architecture, /不复制平台解析、Prompt、Schema 或七阶段/u);
});
