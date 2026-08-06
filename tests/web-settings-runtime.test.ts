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
  assert.match(main, /createCapacitorAppRuntime/);
  assert.match(main, /registerHongTaiNativePlugins/);
  assert.match(main, /Capacitor\.convertFileSrc/);
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
  assert.doesNotMatch(ai, /apiKey:\s*/);
});
