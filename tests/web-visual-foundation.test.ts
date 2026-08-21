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

test("shared tabs stay in the components layer so segmented pills survive Android WebView", () => {
  const components = read("styles/components.css");
  const pageSheets = [
    "styles/pages/analysis.css",
    "styles/pages/home.css",
    "styles/pages/tasks-runtime.css",
    "styles/pages/creation.css",
    "styles/pages/production-runtime.css",
    "styles/pages/production-edit.css",
    "styles/pages/replica-wizard.css",
    "styles/pages/library.css",
    "styles/pages/settings.css",
    "styles/pages/observation-runtime.css",
    "styles/pages/vitality.css",
  ];

  for (const relativePath of pageSheets) {
    assert.doesNotMatch(
      read(relativePath),
      /(?:^|[^a-z-])\.tabs(?:\s|\{|,|:|\.|--)/m,
      `${relativePath} must not restyle shared .tabs; layer(pages) would clip segmented labels`,
    );
  }

  assert.match(components, /\.tabs--segmented\s*\{[^}]*display:\s*grid/s);
  assert.match(components, /\.tabs--segmented\s*\{[^}]*grid-auto-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(components, /\.tabs button\s*\{[^}]*appearance:\s*none/s);
  assert.match(components, /\.tabs--segmented button\s*\{[^}]*appearance:\s*none/s);
  assert.match(components, /\.tabs--segmented button\s*\{[^}]*min-height:\s*0/s);
  assert.match(components, /\.tabs--segmented button\s*\{[^}]*height:\s*1\.75rem/s);
  assert.match(components, /\.tabs--segmented button\s*\{[^}]*background:\s*transparent/s);
  assert.match(components, /\.tabs--segmented button\.is-active\s*\{[^}]*background:\s*var\(--color-surface-card\)/s);
  assert.match(components, /\.tabs--segmented button\.is-active::after\s*\{[^}]*display:\s*none/s);
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
