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

test("the merged candidate is v0.1.5/code 12 and advances beyond published v0.1.4", () => {
  const gradle = readFileSync(join(root, "android", "app", "build.gradle.kts"), "utf8");
  const downloadPage = readFileSync(join(root, "download.html"), "utf8");
  const candidateCode = Number(requireMatch(gradle, /versionCode\s*=\s*(\d+)/u, "Android versionCode"));
  const candidateName = requireMatch(gradle, /versionName\s*=\s*"([^"]+)"/u, "Android versionName");
  const publishedName = requireMatch(downloadPage, /aria-label="当前推荐版本 v([0-9.]+)"/u, "published download version");

  assert.equal(candidateCode, 12);
  assert.equal(candidateName, "0.1.5");
  assert.equal(publishedName, "0.1.4");
  assert.ok(compareVersion(candidateName, publishedName) > 0, `versionName ${candidateName} must advance beyond published ${publishedName}`);
});

test("the misidentified same-name v0.1.5 APK is withdrawn instead of offered as an upgrade", () => {
  const downloadPage = readFileSync(join(root, "download.html"), "utf8");

  assert.match(downloadPage, /已撤回测试包 · v0\.1\.5 开发批次/u);
  assert.match(downloadPage, /包内真实身份为 0\.0\.1 \/ versionCode 3/u);
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
  assert.match(changelog, /默认只递增第三位补丁版本/u);
  assert.match(changelog, /第一位或第二位版本号.*明确授权/u);
});
