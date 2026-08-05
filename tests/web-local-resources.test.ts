import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("Pulse Flow brand assets preserve the supplied raster source", () => {
  for (const relativePath of [
    "apps/web/public/brand/pulse-flow-source.png",
    "apps/web/public/brand/pulse-flow-mark.png",
  ]) {
    const assetPath = join(root, relativePath);
    assert.equal(existsSync(assetPath), true, `${relativePath} should exist`);
    assert.ok(statSync(assetPath).size > 10_000, `${relativePath} should not be a placeholder`);
    assert.deepEqual([...readFileSync(assetPath).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${relativePath} should be a PNG`);
  }

  const brandLogo = read("apps/web/src/components/BrandLogo.tsx");
  assert.match(brandLogo, /\/brand\/pulse-flow-source\.png/);
  assert.match(brandLogo, /\/brand\/pulse-flow-mark\.png/);
  assert.match(brandLogo, /宏泰AI智能体/);
});

test("page brand mark stays transparent while the app icon keeps its frame", () => {
  const markPath = join(root, "apps", "web", "public", "brand", "pulse-flow-mark.png");
  const sourcePath = join(root, "apps", "web", "public", "brand", "pulse-flow-source.png");
  const brandLogo = read("apps/web/src/components/BrandLogo.tsx");
  const shellStyles = read("apps/web/src/styles/shell.css");

  assert.equal(existsSync(markPath), true, "the page mark should be a separate public asset");
  assert.equal(existsSync(sourcePath), true, "the original source should remain available for the app icon");
  assert.deepEqual([...readFileSync(markPath).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual([...readFileSync(sourcePath).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(brandLogo, /variant\?:\s*"mark"\s*\|\s*"icon"\s*\|\s*"lockup"/);
  assert.match(brandLogo, /variant\s*=\s*"mark"/);
  assert.match(brandLogo, /\/brand\/pulse-flow-mark\.png/);
  assert.match(brandLogo, /\/brand\/pulse-flow-source\.png/);
  assert.match(shellStyles, /\.brand-logo--mark[\s\S]*border:\s*0/);
  assert.match(shellStyles, /\.brand-logo--mark[\s\S]*background:\s*transparent/);
  assert.match(shellStyles, /\.app-header--brand\s*\{[\s\S]*grid-template-columns:\s*3\.5625rem/);
  assert.match(shellStyles, /\.brand-logo--mark\s*\{[\s\S]*width:\s*3\.125rem;[\s\S]*height:\s*2\.0625rem/);
  assert.match(shellStyles, /\.brand-logo--mark\s+img\s*\{[\s\S]*object-fit:\s*contain/);
});

test("Chinese UI font is bundled locally for web and future APK packaging", () => {
  const fontPath = join(root, "apps/web/public/fonts/NotoSansSC-VF.woff2");
  assert.equal(existsSync(fontPath), true, "Noto Sans SC variable font should be bundled");
  assert.ok(statSync(fontPath).size > 100_000, "bundled font should not be a placeholder");

  const foundation = read("apps/web/src/styles/foundation.css");
  const tokens = read("apps/web/src/styles/tokens.css");
  assert.match(foundation, /@font-face/);
  assert.match(foundation, /\/fonts\/NotoSansSC-VF\.woff2/);
  assert.match(tokens, /--font-body:\s*[\s\S]*Noto Sans SC/);
});

test("visual type tokens keep Chinese labels out of tiny caption sizes", () => {
  const tokens = read("apps/web/src/styles/tokens.css");
  assert.match(tokens, /--text-body:\s*1rem/);
  assert.match(tokens, /--text-caption:\s*0\.8125rem/);
  assert.match(tokens, /--text-meta:\s*0\.75rem/);

  for (const relativePath of [
    "apps/web/src/styles/pages/home.css",
    "apps/web/src/styles/pages/analysis.css",
    "apps/web/src/styles/pages/creation.css",
    "apps/web/src/styles/pages/library.css",
    "apps/web/src/styles/pages/vitality.css",
  ]) {
    assert.doesNotMatch(read(relativePath), /font-size:\s*0\.(?:5\d|6\d|7[0-4])rem/);
  }
});

test("static visual media does not depend on Google-hosted image URLs", () => {
  const fixture = read("apps/web/src/data/fixtures/media.ts");
  assert.doesNotMatch(fixture, /lh3\.googleusercontent\.com/);
  assert.match(fixture, /\/media\/workwear\.jpg/);
  assert.match(fixture, /\/media\/tongue\.jpg/);
});
