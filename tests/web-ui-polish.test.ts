import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("observation image choice centers each placeholder item and keeps the report action black-on-green", () => {
  const css = read("apps/web/src/styles/pages/observation-runtime.css");

  assert.match(css, /\.observation-capture-card__empty\s*\{[^}]*place-items:\s*center[^}]*justify-items:\s*center/s);
  assert.match(css, /\.observation-capture-card__empty\s+svg\s*\{[^}]*justify-self:\s*center/s);
  assert.match(css, /\.observation-capture-card__actions\s+\.button--primary\s*\{[^}]*color:\s*#000/s);
  assert.match(css, /\.observation-capture-card__actions\s+\.button--primary:disabled\s*\{[^}]*color:\s*#000/s);
});

test("Android edge-to-edge keeps header content below status icons without reintroducing a separate page spacer", () => {
  const main = read("apps/web/src/main.tsx");
  const shell = read("apps/web/src/styles/shell.css");

  assert.match(main, /document\.documentElement\.dataset\.platform\s*=\s*Capacitor\.getPlatform\(\)/);
  assert.match(shell, /:root\[data-platform="android"\]\s*\{[^}]*--native-status-bar-inset:\s*24px/s);
  assert.match(shell, /\.app-header\s*\{[^}]*max\(env\(safe-area-inset-top\),\s*var\(--native-status-bar-inset\)\)/s);
  assert.match(shell, /\.app-content\s*\{[^}]*max\(env\(safe-area-inset-top\),\s*var\(--native-status-bar-inset\)\)/s);
});

test("runtime video frames adopt real media dimensions instead of retaining a landscape placeholder", () => {
  const component = read("apps/web/src/components/RuntimeMediaFrame.tsx");
  const css = read("apps/web/src/styles/pages/tasks-runtime.css");

  assert.match(component, /media\.width/);
  assert.match(component, /media\.height/);
  assert.match(component, /onLoadedMetadata/);
  assert.match(component, /videoWidth/);
  assert.match(component, /videoHeight/);
  assert.match(component, /data-media-orientation/);
  assert.match(css, /\.runtime-video-frame\[data-media-orientation="portrait"\]/);
  assert.doesNotMatch(css, /\.runtime-video-frame\s*\{\s*aspect-ratio:\s*16\s*\/\s*9\s*;/s);
});

test("Android device settings bridge exposes build identity and only opens the explicit system TTS settings", () => {
  const pluginPath = "android/app/src/main/java/com/hongtai/aiagent/bridge/DeviceSettingsPlugin.kt";
  assert.equal(existsSync(join(root, pluginPath)), true, "missing DeviceSettings bridge");
  const plugin = read(pluginPath);
  const mainActivity = read("android/app/src/main/java/com/hongtai/aiagent/MainActivity.kt");
  const bridge = read("packages/capacitor-runtime/src/standalone-bridge.ts");

  assert.match(plugin, /@CapacitorPlugin\(name = "DeviceSettings"\)/);
  assert.match(plugin, /packageManager\.getPackageInfo/);
  assert.match(plugin, /versionName/);
  assert.match(plugin, /longVersionCode/);
  assert.match(plugin, /TextToSpeech\.Engine\.ACTION_INSTALL_TTS_DATA/);
  assert.match(mainActivity, /registerPlugin\(DeviceSettingsPlugin::class\.java\)/);
  assert.match(bridge, /StandaloneDeviceSettingsPlugin/);
  assert.match(bridge, /registerPlugin<StandaloneDeviceSettingsPlugin>\("DeviceSettings"\)/);
});
