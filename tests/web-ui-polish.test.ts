import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("observation capture prompt sits at the bottom of the photo with luminous body type and a laser scan", () => {
  const css = read("apps/web/src/styles/pages/observation-runtime.css");
  const panels = read("apps/web/src/features/diagnosis/observation-start-panels.tsx");

  assert.match(css, /\.observation-capture-card__empty\s*\{[^}]*bottom:\s*0[^}]*padding:\s*3\.25rem 1rem 1\.7rem/s);
  assert.match(css, /\.observation-capture-card__empty\s+svg\s*\{[^}]*justify-self:\s*center/s);
  assert.match(css, /\.observation-capture-card__empty strong,\s*\.observation-capture-card__empty span\s*\{[^}]*font-weight:\s*500[^}]*letter-spacing:\s*0\.06em[^}]*text-shadow/s);
  assert.match(css, /\.observation-capture-card__empty span\s*\{[^}]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.78\)/s);
  assert.match(css, /\.observation-capture-card__brackets i\s*\{[^}]*border:\s*0\.125rem solid var\(--palette-on-ink\)/s);
  assert.doesNotMatch(panels, /点击添加图片进行诊断/);
  assert.match(panels, /observationScanCaption/);
  assert.match(css, /\.observation-capture-card__laser::after\s*\{[^}]*animation:\s*observation-laser-scan/s);
  assert.match(css, /\.observation-confirm-actions\s+\.button--primary\s*\{[^}]*color:\s*var\(--color-text-on-primary\)/s);
  assert.match(css, /\.observation-confirm-actions\s+\.button--primary:disabled\s*\{[^}]*color:\s*var\(--color-text-muted\)/s);
  assert.match(css, /\.observation-confirm-actions\s+\.button--primary\.is-busy:disabled\s*\{[^}]*linear-gradient/s);
  assert.match(css, /\.observation-follow-up-composer__send\.is-busy:disabled\s*\{[^}]*opacity:\s*1/s);
});

test("Android edge-to-edge keeps header content below status icons without reintroducing a separate page spacer", () => {
  const main = read("apps/web/src/main.tsx");
  const shell = read("apps/web/src/styles/shell.css");
  const responsive = read("apps/web/src/styles/responsive.css");

  assert.match(main, /document\.documentElement\.dataset\.platform\s*=\s*Capacitor\.getPlatform\(\)/);
  assert.match(main, /installVisualViewportInset\(\)/);
  assert.match(shell, /:root\[data-platform="android"\]\s*\{[^}]*--native-status-bar-inset:\s*24px/s);
  assert.match(shell, /:root\[data-platform="android"\]\s*\{[^}]*--native-nav-bar-inset:\s*24px/s);
  assert.match(shell, /\.app-header\s*\{[^}]*max\(env\(safe-area-inset-top\),\s*var\(--native-status-bar-inset\)\)/s);
  assert.match(shell, /\.app-content\s*\{[^}]*max\(env\(safe-area-inset-top\),\s*var\(--native-status-bar-inset\)\)/s);
  assert.match(responsive, /@media\s*\(min-width:\s*48rem\)\s*\{[\s\S]*?\.app-content\s*\{[^}]*--header-height[^}]*max\(env\(safe-area-inset-top\),\s*var\(--native-status-bar-inset\)\)/);
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

test("Android device settings bridge exposes build identity without creating a separate TTS settings surface", () => {
  const pluginPath = "android/app/src/main/java/com/hongtai/aiagent/bridge/DeviceSettingsPlugin.kt";
  assert.equal(existsSync(join(root, pluginPath)), true, "missing DeviceSettings bridge");
  const plugin = read(pluginPath);
  const mainActivity = read("android/app/src/main/java/com/hongtai/aiagent/MainActivity.kt");
  const bridge = read("packages/capacitor-runtime/src/standalone-bridge.ts");

  assert.match(plugin, /@CapacitorPlugin\(name = "DeviceSettings"\)/);
  assert.match(plugin, /packageManager\.getPackageInfo/);
  assert.match(plugin, /versionName/);
  assert.match(plugin, /longVersionCode/);
  assert.doesNotMatch(plugin, /TextToSpeech|ACTION_INSTALL_TTS_DATA/);
  assert.match(mainActivity, /registerPlugin\(DeviceSettingsPlugin::class\.java\)/);
  assert.match(bridge, /StandaloneDeviceSettingsPlugin/);
  assert.match(bridge, /registerPlugin<StandaloneDeviceSettingsPlugin>\("DeviceSettings"\)/);
  assert.doesNotMatch(bridge, /openTextToSpeechSettings/);
});

test("application information explains recent improvements in product language", () => {
  const page = read("apps/web/src/pages/ApplicationInfoPage.tsx");

  assert.match(page, /智能成片修好了：一句话需求直接开始，不再误报/u);
  assert.match(page, /数字人先传视频再制作：打开「数字人出镜」就能直接上传数字人视频/u);
  assert.match(page, /看得见 AI 在想什么：分镜脚本生成时实时流出 AI 的深度思考过程/u);
  assert.match(page, /删除确认统一了：项目、素材、成片、任务、模板的删除都从底部弹出确认层/u);
  assert.match(page, /错误不再重复刷屏：同一错误只在一个地方说清楚/u);
  assert.doesNotMatch(page, /紧凑结构化生成|字段校验|整文校正|半截 JSON|私有地址|pathname|查询串/u);
});
