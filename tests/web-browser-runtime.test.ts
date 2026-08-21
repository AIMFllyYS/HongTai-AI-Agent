import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("浏览器入口仅在非原生平台注入本地 I/O，且不把 Node runtime 打进 APK", () => {
  const main = read("apps/web/src/main.tsx");
  const vite = read("apps/web/vite.config.ts");
  const plugin = read("apps/web/vite-hongtai-browser-io.ts");
  const client = read("apps/web/src/runtime/browser-native/io-client.ts");
  const plugins = read("apps/web/src/runtime/browser-native/create-browser-plugins.ts");

  assert.match(main, /Capacitor\.isNativePlatform\(\)/);
  assert.match(main, /registerStandaloneNativePlugins/);
  assert.match(main, /createBrowserStandalonePlugins/);
  assert.match(main, /browserConvertFileSrc/);
  assert.doesNotMatch(main, /node:|\.env|@hongtai\/node-runtime|FileArtifactStore|FfmpegMediaTools/);

  assert.match(vite, /hongtaiBrowserIo/);
  assert.match(plugin, /127\.0\.0\.1/);
  assert.match(plugin, /x-hongtai-browser-io/);
  assert.doesNotMatch(plugin, /console\.log/);
  assert.match(plugin, /active-ai-connection/);
  assert.match(plugin, /authorization: `Bearer \$\{apiKey\}`/);
  assert.doesNotMatch(plugin, /console\.(?:log|info|debug|error)/);

  assert.match(client, /__hongtai-io\/rpc/);
  assert.match(client, /file:\/\/\/hongtai-browser-io\//);
  assert.match(plugins, /ERR_MEDIA_ENCODER_UNAVAILABLE/);
  assert.match(plugins, /nativeFileUri/);
  assert.doesNotMatch(plugins, /@hongtai\/node-runtime|node:child_process/);
});

test("制作页在列表成功或明确未找到后才消费 sourceId", () => {
  const page = read("apps/web/src/pages/CreatePage.tsx");
  const model = read("apps/web/src/pages/task-page-model.ts");
  assert.match(model, /export function peekCreateSourceIdFromSearch/);
  assert.match(page, /peekCreateSourceIdFromSearch\(\)/);
  assert.match(page, /consumeCreateSourceIdFromSearch\(\)/);
  const load = page.slice(page.indexOf("const load = useCallback"), page.indexOf("}, [runtime, searchEpoch]);"));
  assert.ok(load.indexOf("peekCreateSourceIdFromSearch") < load.indexOf("try {"));
  assert.ok(load.indexOf("runtime.tasks.list") < load.indexOf("consumeCreateSourceIdFromSearch"));
  assert.ok(load.indexOf("consumeCreateSourceIdFromSearch") < load.indexOf("} catch (error)"));
});
