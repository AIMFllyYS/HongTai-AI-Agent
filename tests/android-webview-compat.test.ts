import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("Android rejects WebViews below the application capability floor", () => {
  const config = read("capacitor.config.ts");
  const packagedConfig = JSON.parse(
    read("android/app/src/main/assets/capacitor.config.json"),
  ) as { android?: Record<string, unknown>; server?: Record<string, unknown> };
  const guide = read("docs/Android旧系统HEIF兼容与依赖指南.md");

  assert.match(config, /minWebViewVersion:\s*99\b/);
  assert.match(config, /minHuaweiWebViewVersion:\s*2147483647\b/);
  assert.match(config, /errorPath:\s*"unsupported-webview\.html"/);
  assert.equal(packagedConfig.android?.minWebViewVersion, 99);
  assert.equal(packagedConfig.android?.minHuaweiWebViewVersion, 2147483647);
  assert.equal(packagedConfig.server?.errorPath, "unsupported-webview.html");
  assert.match(guide, /Huawei provider[^\n]*fail-closed/);
  assert.match(guide, /不声明支持 Huawei provider/);
});

test("the production web bundle targets the declared Chromium floor", () => {
  const vite = read("apps/web/vite.config.ts");

  assert.match(vite, /build:\s*\{[\s\S]*target:\s*"chrome99"[\s\S]*\}/);
});

test("the unsupported WebView page is local static Chinese HTML", () => {
  const relativePath = "apps/web/public/unsupported-webview.html";
  assert.equal(existsSync(join(root, relativePath)), true, "missing unsupported WebView page");
  const page = read(relativePath);

  assert.match(page, /<meta\s+charset="UTF-8"/i);
  assert.match(page, /WebView/);
  assert.match(page, /[\u3400-\u9fff]/);
  assert.doesNotMatch(page, /<script\b|<link\b|<iframe\b|\son\w+\s*=|@import/i);
  assert.doesNotMatch(page, /https?:\/\/|\/\/|location\s*[.=]|http-equiv\s*=\s*["']refresh/i);
});

test("release packaging verifies the new monotonic candidate version", () => {
  const appBuild = read("android/app/build.gradle.kts");
  const releaseBuilder = read("scripts/build-android-release.ps1");

  assert.match(appBuild, /versionCode\s*=\s*6\b/);
  assert.match(appBuild, /versionName\s*=\s*"0\.0\.1"/);
  assert.match(releaseBuilder, /\$versionCode\s+-ne\s+"6"/);
});
