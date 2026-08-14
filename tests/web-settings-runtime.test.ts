import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("the application shell initializes the Capacitor AppRuntime instead of a default design fixture", () => {
  const app = read("App.tsx");
  const main = read("main.tsx");

  assert.match(app, /runtime\?:\s*AppRuntime/);
  assert.doesNotMatch(app, /injectedVisualData\s*\?\?\s*createStaticVisualDataAdapter/);
  assert.match(main, /createStandaloneAppRuntime/);
  assert.match(main, /registerStandaloneNativePlugins/);
  assert.doesNotMatch(main, /createCapacitorAppRuntime|registerHongTaiNativePlugins/);
  assert.match(main, /Capacitor\.convertFileSrc/);
});

test("APK startup reconciles every unfinished file snapshot without resuming its pipeline", () => {
  const main = read("main.tsx");

  assert.match(main, /recovery\.recoverInterruptedWork\(\)/);
  assert.doesNotMatch(main, /tasks\.getStartupRecovery\(\)/);
  assert.doesNotMatch(main, /tasks\.start\(/);
});

test("settings routes are rendered from the shared runtime and do not expose direct native plugins", () => {
  const app = read("App.tsx");
  const settings = read("pages/SettingsPage.tsx");
  const profile = "pages/ProfileSettingsPage.tsx";
  const ai = "pages/AiSettingsPage.tsx";

  assert.match(app, /settings-profile/);
  assert.match(app, /settings-ai/);
  assert.equal(existsSync(join(root, profile)), true);
  assert.equal(existsSync(join(root, ai)), true);
  for (const page of [settings, read(profile), read(ai)]) {
    assert.match(page, /AppRuntime/);
    assert.doesNotMatch(page, /@capacitor\/core/);
    assert.doesNotMatch(page, /registerPlugin/);
  }
});

test("profile and AI settings preserve local-only security boundaries", () => {
  const settings = read("pages/SettingsPage.tsx");
  const profile = read("pages/ProfileSettingsPage.tsx");
  const ai = read("pages/AiSettingsPage.tsx");

  assert.match(settings, /runtime\.profile\.get/);
  assert.match(settings, /runtime\.aiSettings\.getPublic/);
  assert.match(profile, /runtime\.profile\.pickAvatar/);
  assert.match(profile, /runtime\.profile\.update/);
  assert.match(ai, /type="password"/);
  assert.match(ai, /runtime\.aiSettings\.replaceApiKey/);
  assert.match(ai, /runtime\.aiSettings\.probe/);
  assert.match(ai, /runtime\.aiSettings\.getProbeResults/);
  assert.doesNotMatch(settings, /PRO|退出登录|首选配音/);
  assert.match(ai, /runtime\.aiSettings\.save\(inputFromDraft\(nextDraft\)\)/);
  const publicInput = ai.match(/function inputFromDraft[\s\S]*?\r?\n}\r?\n\r?\n\/\*\*/)?.[0];
  assert.ok(publicInput, "the public connection input mapper should be present");
  assert.doesNotMatch(publicInput ?? "", /apiKey\s*:/);
});

test("UI copy describes local app storage and Keystore without promising an encrypted database", () => {
  const app = read("App.tsx");
  const main = read("main.tsx");
  const settings = read("pages/SettingsPage.tsx");
  const profile = read("pages/ProfileSettingsPage.tsx");
  const ai = read("pages/AiSettingsPage.tsx");

  for (const source of [app, main, settings, profile, ai]) {
    assert.doesNotMatch(source, /SQLCipher|加密数据库|本地加密存储|加密档案|DATABASE_OPEN_FAILED/);
  }
  assert.match(main, /正在准备你的本地内容/);
  assert.doesNotMatch(main, /title="本地运行时|description="[^"]*运行时/u);
  assert.match(settings, /本机应用数据/);
  assert.match(settings, /Android Keystore/);
});

test("AI capability probes cannot run against a saved connection while the visible form is unsaved", () => {
  const ai = read("pages/AiSettingsPage.tsx");

  assert.match(ai, /hasUnsavedProbeInputs/);
  assert.match(ai, /const probeBlocked = connectionBusy \|\| hasUnsavedProbeInputs/);
  assert.match(ai, /if \(probeBlocked\) return/);
  assert.match(ai, /for \(const capability of probeCapabilities\) \{\s*const result = await runProbe\(capability\);/s);
  assert.match(ai, /disabled=\{probeBlocked\}/);
  assert.match(ai, /请先保存当前 AI 设置后再测试/);
});

test("settings keep cloud TTS inside AI connection and expose app information through AppRuntime", () => {
  const app = read("App.tsx");
  const settings = read("pages/SettingsPage.tsx");
  const ai = read("pages/AiSettingsPage.tsx");
  const router = read("router.ts");

  assert.match(settings, /appInfoSettingsPath/);
  assert.match(settings, /应用信息/);
  assert.match(ai, /一键配置/);
  assert.match(ai, /视频配音模型/);
  assert.match(ai, /AI_PROVIDER_PRESETS/);
  assert.doesNotMatch(settings, /data-settings-capability="tts"/);
  assert.doesNotMatch(settings, /TTS 语音合成/);
  assert.doesNotMatch(router, /settings-tts/);
  assert.match(router, /settings-app-info/);
  assert.doesNotMatch(app, /TtsSettingsPage/);
  assert.match(app, /ApplicationInfoPage/);
});
