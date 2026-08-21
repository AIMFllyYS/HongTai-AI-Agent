import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

const DARK_REMAPS: ReadonlyArray<readonly [string, string]> = [
  ["--palette-brand-tint", "#16352c"],
  ["--palette-mint-whisper", "#1a2e28"],
  ["--palette-silk", "#1c1f1d"],
  ["--palette-deep-emerald", "#6ee7c5"],
  ["--palette-brand-deep", "#34d399"],
  ["--surface-success", "#16351f"],
  ["--surface-warning", "#3a2c14"],
  ["--surface-error", "#3a1c1a"],
  ["--overlay-scrim", "rgba(0, 0, 0, 0.56)"],
];

const LIGHT_UNCHANGED: ReadonlyArray<readonly [string, string]> = [
  ["--palette-brand-tint", "#e6f7f1"],
  ["--palette-mint-whisper", "#f2f7f2"],
  ["--palette-silk", "#fbfdfa"],
  ["--palette-deep-emerald", "#004d40"],
  ["--palette-brand-deep", "#0c8a66"],
  ["--surface-canvas", "#ffffff"],
  ["--surface-success", "#dcfce7"],
  ["--surface-warning", "#ffedd5"],
  ["--surface-error", "#ffdad6"],
];

function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    map.set(match[1], match[2].trim());
  }
  return map;
}

function blockAfter(css: string, marker: string): string {
  const idx = css.indexOf(marker);
  assert.ok(idx >= 0, `${marker} should exist`);
  const start = css.indexOf("{", idx);
  assert.ok(start >= 0, `${marker} should open a block`);
  let depth = 0;
  for (let i = start; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start + 1, i);
    }
  }
  assert.fail(`${marker} should close a block`);
}

function lightRootBlock(css: string): string {
  return blockAfter(css, ":root {");
}

function darkBlocks(css: string): readonly [string, string] {
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  return [
    blockAfter(css, ':root:not([data-color-scheme="light"])'),
    blockAfter(css, ':root[data-color-scheme="dark"]'),
  ];
}

test("light :root keeps the NA2 mint and paper values", () => {
  const light = declarations(lightRootBlock(read("apps/web/src/styles/tokens.css")));
  for (const [token, value] of LIGHT_UNCHANGED) {
    assert.equal(light.get(token), value, `${token} must stay ${value} in light :root`);
  }
});

test("both dark selectors remap tint, silk, status-soft, and deep-emerald together", () => {
  const css = read("apps/web/src/styles/tokens.css");
  const [media, explicit] = darkBlocks(css);
  const mediaDecls = declarations(media);
  const explicitDecls = declarations(explicit);

  assert.deepEqual([...mediaDecls.keys()], [...explicitDecls.keys()], "both dark blocks must declare the same variables");
  for (const [token, value] of DARK_REMAPS) {
    assert.equal(mediaDecls.get(token), value, `media dark ${token}`);
    assert.equal(explicitDecls.get(token), value, `forced dark ${token}`);
  }
});

test("Android night splash uses the dark canvas without changing the light color", () => {
  const light = read("android/app/src/main/res/values/colors.xml");
  const nightPath = join(root, "android/app/src/main/res/values-night/colors.xml");
  assert.equal(existsSync(nightPath), true, "values-night/colors.xml should exist");
  const night = readFileSync(nightPath, "utf8");
  assert.match(light, /name="brand_splash_background">#F2F7F2/);
  assert.match(night, /name="brand_splash_background">#121413/);
});
