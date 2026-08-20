import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("visual styles expose an explicit responsibility-based cascade", () => {
  const entry = read("styles/global.css");

  assert.match(entry, /@layer\s+reset,\s*base,\s*shell,\s*components,\s*pages,\s*themes,\s*responsive/);
  for (const relativePath of [
    "styles/foundation.css",
    "styles/shell.css",
    "styles/components.css",
    "styles/pages/home.css",
    "styles/pages/analysis.css",
    "styles/pages/creation.css",
    "styles/pages/library.css",
    "styles/pages/vitality.css",
    "styles/responsive.css",
  ]) {
    assert.equal(existsSync(join(root, relativePath)), true, `${relativePath} should exist`);
  }
});

test("visual tokens provide the mobile redesign palette", () => {
  const tokens = read("styles/tokens.css");

  for (const token of [
    "--palette-brand",
    "--palette-ink-900",
    "--color-surface-canvas",
    "--color-action-primary",
    "--color-text-primary",
    "--color-focus-ring",
    "--color-status-success",
    "--palette-deep-emerald",
  ]) {
    assert.match(tokens, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${token} should be defined`);
  }

  for (const legacyTone of ["#b07150", "#f2dfd2", "#4a3328"]) {
    assert.doesNotMatch(tokens, new RegExp(legacyTone, "i"), `${legacyTone} should not be a token`);
  }
});

test("legacy vitality brown overrides are removed from the stylesheet graph", () => {
  const stylesheetPaths = [
    "styles/tokens.css",
    "styles/global.css",
    "styles/foundation.css",
    "styles/shell.css",
    "styles/components.css",
    "styles/pages/home.css",
    "styles/pages/analysis.css",
    "styles/pages/creation.css",
    "styles/pages/library.css",
    "styles/pages/vitality.css",
    "styles/responsive.css",
  ];

  const styles = stylesheetPaths.filter((relativePath) => existsSync(join(root, relativePath))).map(read).join("\n");
  for (const legacyTone of ["#b07150", "#f2dfd2", "#4a3328"]) {
    assert.doesNotMatch(styles, new RegExp(legacyTone, "i"), `${legacyTone} should be absent`);
  }
});
