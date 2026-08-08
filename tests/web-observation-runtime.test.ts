import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const webRoot = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

test("observation pages use the real diagnosis runtime rather than a visual diagnosis fixture", () => {
  for (const relativePath of [
    "pages/ObservationStartPage.tsx",
    "pages/ObservationReportPage.tsx",
    "features/diagnosis/diagnosis-presenters.ts",
  ]) {
    assert.equal(existsSync(join(webRoot, relativePath)), true, `${relativePath} should exist`);
    assert.doesNotMatch(read(relativePath), /data\/fixtures/);
  }

  const start = read("pages/ObservationStartPage.tsx");
  assert.match(start, /runtime\.diagnosis\.pickImage/);
  assert.match(start, /runtime\.diagnosis\.captureImage/);
  assert.match(start, /runtime\.diagnosis\.createSession/);
  assert.match(start, /runtime\.diagnosis\.runReport/);
  assert.match(start, /id:\s*"tongue"/);
  assert.match(start, /id:\s*"face"/);

  const report = read("pages/ObservationReportPage.tsx");
  assert.match(report, /runtime\.diagnosis\.getReport/);
  assert.match(report, /runtime\.diagnosis\.listMessages/);
  assert.match(report, /runtime\.diagnosis\.followUp/);
  assert.match(report, /followUpQuestions/);
  assert.match(report, /content_delta/);
  assert.match(report, /reportRetryAllowed/);
  assert.match(report, /selectMedia:\s*\(\) => navigate\(observationNewPath\(\)\)/);
  assert.match(report, /maxLength=\{20_000\}/);

  // A report page can only show an explicit retry when the persisted issue
  // itself authorizes it; storage/media/settings issues stay in IssueNotice.
  assert.match(report, /reportIssue\?\.action === "retry"/);

  // The start page must not navigate to a stale `running` report when native
  // storage failed before a terminal projection could be committed.
  assert.match(start, /stored\?\.status === "succeeded" \|\| stored\?\.status === "failed"/);

  const app = read("App.tsx");
  assert.match(app, /ObservationStartPage/);
  assert.match(app, /ObservationReportPage/);
  assert.match(app, /runtime && renderedRoute\.key === "observation-new"/);
  assert.match(app, /runtime && renderedRoute\.key === "observation-report"/);
  assert.match(app, /<ObservationStartPage navigate=\{navigate\} runtime=\{runtime\} \/>/);
  assert.match(app, /<ObservationReportPage key=\{sessionId\} navigate=\{navigate\} runtime=\{runtime\} sessionId=\{sessionId\} \/>/);

  const navigation = read("navigation/primary-nav.ts");
  assert.match(navigation, /id: "ai", label: "AI", icon: "health_cross", path: pathForRoute\("observation-new"\)/);
});

test("observation session creation uses a storage fallback instead of runtime unavailable", () => {
  const start = read("pages/ObservationStartPage.tsx");
  assert.doesNotMatch(start, /code:\s*"APP_RUNTIME_UNAVAILABLE",\s*message:\s*"无法创建本地观察会话"/);
  assert.match(start, /code:\s*"STORAGE_WRITE_FAILED",\s*message:\s*"无法创建本地观察会话"/);
});

test("observation photo selection and capture own an importing state with every terminal clearing busy", () => {
  const start = read("pages/ObservationStartPage.tsx");

  assert.match(start, /const \[importing, setImporting\] = useState\(true\)/);
  assert.match(start, /runtime\.diagnosis\.consumeImageRecovery\(\)/);
  assert.match(start, /recovered\.status === "succeeded"[\s\S]*setImage\(recovered\.image\)/);
  assert.match(start, /recovered\.status === "failed"[\s\S]*setIssue\(recovered\.issue\)/);

  const picker = start.match(/const pickImage = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? "";
  const capture = start.match(/const captureImage = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? "";
  for (const operation of [picker, capture]) {
    assert.match(operation, /setImporting\(true\)/);
    assert.match(operation, /finally\s*\{[\s\S]*setImporting\(false\)/);
    assert.match(operation, /loading \|\| importing/);
  }

  assert.match(start, /正在导入图片/);
  assert.match(start, /disabled=\{!diagnosisAvailable \|\| loading \|\| importing\}/);
  assert.match(start, /disabled=\{!diagnosisAvailable \|\| !image \|\| loading \|\| importing\}/);
});

test("observation presentation only recognizes diagnosis-report.v1 and never turns it into a score", async () => {
  const subject = await import("../apps/web/src/features/diagnosis/diagnosis-presenters");

  const report = subject.readDiagnosisReport({
    sessionId: "observation-1",
    status: "succeeded",
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:01:00.000Z",
    report: {
      schemaVersion: "diagnosis-report.v1",
      document: {
        mode: "tongue",
        imageQuality: { usable: true, overallQuality: "good", limitations: [], retakeSuggestions: [] },
        summary: { headline: "观察报告", keyPoints: ["舌面清晰"], narrative: "仅作日常参考。" },
        observations: [{ id: "o-1", category: "tongue_body", region: "舌体", label: "颜色", description: "可见颜色特征", visibility: "clear", evidenceDescription: "图片中央区域清晰" }],
        wellnessReferences: [{ title: "日常参考", basisObservationIds: ["o-1"], statement: "请结合日常状态留意变化", certainty: "possible", notADiagnosis: true }],
        recommendations: [{ category: "daily_care", priority: "low", title: "规律记录", action: "在相近光线下观察", rationale: "便于比较", relatedObservationIds: ["o-1"] }],
        safetyGuidance: { level: "routine_attention", reasons: ["如有不适请咨询专业人员"], recommendedAction: "必要时咨询专业人员" },
        followUpQuestions: ["如何在相近光线下记录？"],
        limitations: ["单张图片存在局限"],
        disclaimer: "此内容不构成医疗诊断。",
      },
    },
  });

  assert.equal(report.available, true);
  assert.equal(report.mode, "tongue");
  assert.equal(report.summary?.headline, "观察报告");
  assert.deepEqual(report.followUpQuestions, ["如何在相近光线下记录？"]);
  assert.equal("score" in report, false);
  assert.equal(subject.readDiagnosisReport({
    sessionId: "observation-1",
    status: "succeeded",
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:01:00.000Z",
    report: { schemaVersion: "other.v1", document: {} },
  }).available, false);
});

test("the packaged source contains no diagnostic-treatment or health-score copy", () => {
  const forbidden = ["AI 智能诊疗", "诊断结果", "整体健康评分", "轻度气虚"];
  const sources = [
    "pages/VitalityScanPage.tsx",
    "pages/VitalityResultPage.tsx",
    "data/fixtures/vitality.ts",
    "data/visual-types.ts",
  ];
  for (const source of sources) {
    const text = read(source);
    for (const phrase of forbidden) assert.doesNotMatch(text, new RegExp(phrase));
  }
});

test("observation controls stay compact and clear above the fixed Android navigation", () => {
  const start = read("pages/ObservationStartPage.tsx");
  const report = read("pages/ObservationReportPage.tsx");
  const css = read("styles/pages/observation-runtime.css");

  assert.match(start, /observation-capture-card__actions mobile-action-group/);
  assert.match(report, /observation-question-composer__actions/);
  assert.match(css, /\.observation-capture-card__actions \.button--primary\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(css, /\.observation-question-composer\s*\{[^}]*bottom:\s*calc\([^;]*--nav-height[^;]*safe-area-inset-bottom/s);
  assert.match(css, /\.observation-message p\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /@media\s*\(max-width:\s*26\.875rem\)[\s\S]*\.observation-question-composer__actions[^}]*grid-template-columns:\s*1fr/);
});
