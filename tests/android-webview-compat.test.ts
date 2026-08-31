import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("Android uses a reachable OEM-specific WebView compatibility floor", () => {
  const config = read("capacitor.config.ts");
  const packagedConfig = JSON.parse(
    read("android/app/src/main/assets/capacitor.config.json"),
  ) as { android?: Record<string, unknown>; server?: Record<string, unknown> };
  const guide = read("docs/Android旧系统HEIF兼容与依赖指南.md");

  assert.match(config, /minWebViewVersion:\s*89\b/);
  assert.match(config, /minHuaweiWebViewVersion:\s*10\b/);
  assert.doesNotMatch(config, /2147483647/);
  assert.match(config, /errorPath:\s*"unsupported-webview\.html"/);
  assert.equal(packagedConfig.android?.minWebViewVersion, 89);
  assert.equal(packagedConfig.android?.minHuaweiWebViewVersion, 10);
  assert.equal(packagedConfig.server?.errorPath, "unsupported-webview.html");
  assert.match(guide, /Huawei provider[^\n]*独立基线/);
  assert.match(guide, /Chromium 89/);
});

test("the production web bundle targets the declared Chromium floor", () => {
  const vite = read("apps/web/vite.config.ts");

  assert.match(vite, /build:\s*\{[\s\S]*target:\s*"chrome89"[\s\S]*\}/);
});

function listApkRuntimeSources(relativeDir: string): string[] {
  const directory = join(root, relativeDir);
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((entry) => {
      const relative = entry.replaceAll("\\", "/");
      if (!relative.endsWith(".ts") && !relative.endsWith(".tsx")) return false;
      if (relative.endsWith(".test.ts") || relative.endsWith(".test.tsx")) return false;
      if (relative.includes("/browser-native/") || relative.startsWith("browser-native/")) return false;
      if (relative === "node.ts" || relative.endsWith("/node.ts")) return false;
      if (relative.endsWith("fetch-ai-transport.ts")) return false;
      return true;
    })
    .map((entry) => join(relativeDir, entry).replaceAll("\\", "/"));
}

test("WebView 89 runtime paths avoid newer browser-only helpers", () => {
  const apkRuntimeFiles = [
    ...listApkRuntimeSources("apps/web/src"),
    ...listApkRuntimeSources("packages/capacitor-runtime/src"),
    ...listApkRuntimeSources("packages/core/src"),
    ...listApkRuntimeSources("packages/ai/src"),
  ];
  assert.ok(apkRuntimeFiles.some((path) => path.endsWith("production-workbench-model.ts")));
  assert.ok(apkRuntimeFiles.some((path) => path.endsWith("standalone-analysis-service.ts")));
  assert.ok(apkRuntimeFiles.some((path) => path.endsWith("subtitle-timing.ts")));
  assert.ok(apkRuntimeFiles.some((path) => path.endsWith("production-planning-flow.ts")));
  assert.equal(apkRuntimeFiles.some((path) => path.endsWith("fetch-ai-transport.ts")), false);
  assert.equal(apkRuntimeFiles.some((path) => path.endsWith("node.ts")), false);

  const forbidden = /crypto\.randomUUID\(|Object\.hasOwn\(|\.at\(/;
  const offenders = apkRuntimeFiles.filter((path) => forbidden.test(read(path)));
  assert.deepEqual(offenders, []);
});

test("the unsupported WebView page is local static Chinese HTML", () => {
  const relativePath = "apps/web/public/unsupported-webview.html";
  assert.equal(existsSync(join(root, relativePath)), true, "missing unsupported WebView page");
  const page = read(relativePath);

  assert.match(page, /<meta\s+charset="UTF-8"/i);
  assert.match(page, /WebView/);
  assert.match(page, /[\u3400-\u9fff]/);
  assert.match(page, /网页运行组件版本过低，或当前提供程序尚未验证支持/);
  assert.match(page, /若更新后仍显示此页，当前版本暂不支持该网页运行组件/);
  assert.doesNotMatch(page, /当前设备的网页运行组件版本过低，无法安全打开/);
  assert.doesNotMatch(page, /<script\b|<link\b|<iframe\b|\son\w+\s*=|@import/i);
  assert.doesNotMatch(page, /https?:\/\/|\/\/|location\s*[.=]|http-equiv\s*=\s*["']refresh/i);
});

test("release packaging verifies the v0.1.30 monotonic candidate version", () => {
  const appBuild = read("android/app/build.gradle.kts");
  const releaseBuilder = read("scripts/build-android-release.ps1");

  assert.match(appBuild, /versionCode\s*=\s*38\b/);
  assert.match(appBuild, /versionName\s*=\s*"0\.1\.30"/);
  assert.match(releaseBuilder, /Get-AndroidSourceIdentity/);
  assert.match(releaseBuilder, /\$versionCode\s+-ne\s+\$sourceIdentity\.VersionCode/);
  assert.match(releaseBuilder, /\$versionName\s+-ne\s+\$sourceIdentity\.VersionName/);
  assert.doesNotMatch(releaseBuilder, /\$versionCode\s+-ne\s+"14"/);
  assert.doesNotMatch(releaseBuilder, /\$versionName\s+-ne\s+"0\.1\.6"/);
});
