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

  assert.match(page, /制作改成一步一步来：先写一句话需求，AI 流式写出逐句分镜文稿/u);
  assert.match(page, /不用再预先选视频时长：时长由文稿和真实配音音频决定/u);
  assert.match(page, /分镜卡片支持逐句编辑：改文案、换素材、调贴纸都在卡片上就地完成/u);
  assert.match(page, /字幕时间跟着真实语音走：优先按实际读出的时间对齐/u);
  assert.match(page, /「数字人」模式改名「口播切片」，能力不变/u);
  assert.doesNotMatch(page, /紧凑结构化生成|字段校验|整文校正|半截 JSON|私有地址|pathname|查询串/u);
});
