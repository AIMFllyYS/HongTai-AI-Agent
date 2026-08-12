import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("shared shell exposes visual theme and explicit header slots", () => {
  const source = read("components/AppShell.tsx");

  assert.match(source, /visualTheme\?:/);
  assert.match(source, /AppShellVisualTheme\s*=\s*"workbench"\s*\|\s*"warm-soft-tech"/);
  assert.match(source, /leadingAction\?:\s*ReactNode/);
  assert.match(source, /data-visual-theme/);
});

test("shared button and tabs components keep reusable interaction contracts", () => {
  const button = read("components/Buttons.tsx");
  const tabs = read("components/Tabs.tsx");

  assert.match(button, /size\?:\s*"md"\s*\|\s*"lg"/);
  assert.match(button, /button--\$\{size\}/);
  for (const attribute of ["aria-controls", "aria-labelledby", "role=\"tabpanel\""]) {
    assert.match(tabs, new RegExp(attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${attribute} should be wired`);
  }
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
    assert.match(tabs, new RegExp(key), `${key} should be supported`);
  }
});

test("page blocks and visual fixtures are split by responsibility", () => {
  for (const relativePath of [
    "components/Headings.tsx",
    "components/Tabs.tsx",
    "components/ContentBlocks.tsx",
    "data/fixtures/media.ts",
    "data/fixtures/home.ts",
    "data/fixtures/analysis.ts",
    "data/fixtures/creation-library.ts",
    "data/fixtures/vitality.ts",
  ]) {
    assert.equal(existsSync(join(root, relativePath)), true, `${relativePath} should exist`);
  }

  assert.equal(existsSync(join(root, "components/PageBlocks.tsx")), false, "PageBlocks should not remain a responsibility bucket");
  assert.equal(existsSync(join(root, "data/static-visual-adapter.ts")), true);
  assert.match(read("data/static-visual-adapter.ts"), /fixtures\/(home|analysis|creation-library|vitality)/);

  for (const page of ["pages/AnalysisResultPage.tsx", "pages/DetailPage.tsx"]) {
    const source = read(page);
    assert.match(source, /TabPanel/);
    assert.match(source, /tabId/);
    assert.match(source, /tabPanelId/);
  }

  const templates = read("pages/TemplatesPage.tsx");
  assert.match(templates, /runtime\.templates/);
  assert.doesNotMatch(templates, /TabPanel|FeatureUnavailablePanel/);
});

test("App accepts an explicit visual fixture while the production entry uses AppRuntime", () => {
  const source = read("App.tsx");
  const main = read("main.tsx");

  assert.match(source, /interface AppProps/);
  assert.match(source, /visualData\?:\s*VisualDataAdapter/);
  assert.match(source, /runtime\?:\s*AppRuntime/);
  assert.doesNotMatch(source, /injectedVisualData\s*\?\?\s*createStaticVisualDataAdapter/);
  assert.match(main, /createStandaloneAppRuntime/);
  assert.match(main, /registerStandaloneNativePlugins/);
  assert.doesNotMatch(main, /createCapacitorAppRuntime|registerHongTaiNativePlugins/);
});
