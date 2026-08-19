import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();

function requireMatch(value: string, pattern: RegExp, label: string): string {
  const matched = value.match(pattern)?.[1];
  assert.ok(matched, `missing ${label}`);
  return matched;
}

function compareVersion(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

test("the v0.1.17/code 25 source candidate stays ahead of the published v0.1.16 download", () => {
  const gradle = readFileSync(join(root, "android", "app", "build.gradle.kts"), "utf8");
  const downloadPage = readFileSync(join(root, "download.html"), "utf8");
  const sourceCode = Number(requireMatch(gradle, /versionCode\s*=\s*(\d+)/u, "Android versionCode"));
  const sourceName = requireMatch(gradle, /versionName\s*=\s*"([^"]+)"/u, "Android versionName");
  const publishedName = requireMatch(downloadPage, /aria-label="当前推荐版本 v([0-9.]+)"/u, "published download version");

  assert.equal(sourceCode, 25);
  assert.equal(sourceName, "0.1.17");
  assert.equal(publishedName, "0.1.16");
  assert.ok(compareVersion(sourceName, publishedName) >= 0, "source version must never fall behind the published download");
  assert.match(downloadPage, /versionCode:\s*"24"/u);
  assert.match(downloadPage, /21,829,108 bytes/u);
  assert.match(downloadPage, /37580EEDF7587B0C1DF09FC43867DE4029CBF961D2A248E9A05232EC1027F8CA/iu);
  assert.match(downloadPage, /https:\/\/husteread\.com\/storage\/public\/HongTai-AI-Agent-release-v0\.1\.16\.apk/u);
  assert.match(downloadPage, /正式 Release · v0\.1\.16 \/ code24 · 公网哈希已回验/u);
});

test("the superseded v0.1.15/code 23 release stays archived instead of being overwritten", () => {
  const downloadPage = readFileSync(join(root, "download.html"), "utf8");

  assert.match(downloadPage, /versionCode:\s*"23"/u);
  assert.match(downloadPage, /28,989,075 bytes/u);
  assert.match(downloadPage, /75FD98F67918DEF783951B08DD4E5743C9DF6FA2C75A00E8C4C45F739E47E8C0/iu);
  assert.match(downloadPage, /https:\/\/husteread\.com\/storage\/public\/HongTai-AI-Agent-release-v0\.1\.15\.apk/u);
});

test("the superseded v0.1.14/code 22 release stays archived instead of being overwritten", () => {
  const downloadPage = readFileSync(join(root, "download.html"), "utf8");

  assert.match(downloadPage, /versionCode:\s*"22"/u);
  assert.match(downloadPage, /28,986,082 bytes/u);
  assert.match(downloadPage, /D091EDCAA6B7F09CC3A2DB28364CD8C46719412364A7F03F1E010B12BA8E8579/iu);
  assert.match(downloadPage, /https:\/\/husteread\.com\/storage\/public\/HongTai-AI-Agent-release-v0\.1\.14\.apk/u);
});

test("the superseded v0.1.13/code 21 release stays archived instead of being overwritten", () => {
  const downloadPage = readFileSync(join(root, "download.html"), "utf8");

  assert.match(downloadPage, /versionCode:\s*"21"/u);
  assert.match(downloadPage, /28,567,582 bytes/u);
  assert.match(downloadPage, /1C8AB9484245D75D6EE834716A32FBEBFA328B0C031CDF4C3C13B49D5FCB3C52/iu);
  assert.match(downloadPage, /https:\/\/husteread\.com\/storage\/public\/HongTai-AI-Agent-release-v0\.1\.13\.apk/u);
});

test("the superseded v0.1.12/code 20 release stays archived instead of being overwritten", () => {
  const downloadPage = readFileSync(join(root, "download.html"), "utf8");

  assert.match(downloadPage, /versionCode:\s*"20"/u);
  assert.match(downloadPage, /28,958,194 bytes/u);
  assert.match(downloadPage, /F48C3920113DFF48404F3C6454085AE4F30A7C79F8C0EA3F1334E6258FF408CE/iu);
  assert.match(downloadPage, /https:\/\/husteread\.com\/storage\/public\/HongTai-AI-Agent-release-v0\.1\.12\.apk/u);
});

test("the superseded v0.1.11/code 19 release stays archived instead of being overwritten", () => {
  const downloadPage = readFileSync(join(root, "download.html"), "utf8");

  assert.match(downloadPage, /versionCode:\s*"19"/u);
  assert.match(downloadPage, /28,955,602 bytes/u);
  assert.match(downloadPage, /79B0B8090C06D3384993334A89487BC2CA6E0A3CEDC9345195A11C0466DF2DBA/iu);
  assert.match(downloadPage, /https:\/\/husteread\.com\/storage\/public\/HongTai-AI-Agent-release-v0\.1\.11\.apk/u);
});

test("the misidentified same-name v0.1.5 APK is withdrawn instead of offered as an upgrade", () => {
  const downloadPage = readFileSync(join(root, "download.html"), "utf8");

  assert.doesNotMatch(downloadPage, /HongTai-AI-Agent-debug-v0\.1\.5\.apk/u);
});

test("the repository maintains a changelog and a patch-only default version policy", () => {
  const changelogPath = join(root, "CHANGELOG.md");
  assert.equal(existsSync(changelogPath), true, "CHANGELOG.md must exist at the repository root");
  const changelog = readFileSync(changelogPath, "utf8");

  assert.match(changelog, /^# 更新日志/mu);
  assert.match(changelog, /^## \[未发布\]/mu);
  assert.match(changelog, /^## \[0\.1\.5\] - 2026-08-13/mu);
  assert.match(changelog, /^## \[0\.1\.4\] - 2026-08-12/mu);
  assert.match(changelog, /^## \[0\.1\.8\] - 2026-08-15/mu);
  assert.match(changelog, /^## \[0\.1\.9\] - 2026-08-15/mu);
  assert.match(changelog, /^## \[0\.1\.10\] - 2026-08-15/mu);
  assert.match(changelog, /^## \[0\.1\.11\] - 2026-08-15/mu);
  assert.match(changelog, /^## \[0\.1\.12\] - 2026-08-15/mu);
  assert.match(changelog, /^## \[0\.1\.13\] - 2026-08-17/mu);
  assert.match(changelog, /^## \[0\.1\.14\] - 2026-08-17/mu);
  assert.match(changelog, /^## \[0\.1\.15\] - 2026-08-18/mu);
  assert.match(changelog, /^## \[0\.1\.16\] - 2026-08-18/mu);
  assert.match(changelog, /^## \[0\.1\.17\] - 2026-08-20/mu);
  assert.match(changelog, /^## \[0\.1\.7\] - 2026-08-14/mu);
  assert.match(changelog, /Android 源码版本推进为 `0\.1\.12` \/ `versionCode=20`/u);
  assert.match(changelog, /Android 源码版本推进为 `0\.1\.13` \/ `versionCode=21`/u);
  assert.match(changelog, /Android 源码版本推进为 `0\.1\.14` \/ `versionCode=22`/u);
  assert.match(changelog, /Android 源码版本推进为 `0\.1\.15` \/ `versionCode=23`/u);
  assert.match(changelog, /Android 源码版本推进为 `0\.1\.16` \/ `versionCode=24`/u);
  assert.match(changelog, /Android 源码版本推进为 `0\.1\.17` \/ `versionCode=25`/u);
  assert.match(changelog, /默认只递增第三位补丁版本/u);
  assert.match(changelog, /第一位或第二位版本号.*明确授权/u);
});

test("the repository exposes Release as its only APK delivery path", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");

  assert.equal(existsSync(join(root, "scripts", "build-android-debug.ps1")), false);
  assert.match(readme, /唯一 APK 构建与交付入口/u);
  assert.doesNotMatch(readme, /^## 构建 Debug APK$/mu);
  assert.match(agents, /不构建、不交付、不归档 Debug APK/u);
});
