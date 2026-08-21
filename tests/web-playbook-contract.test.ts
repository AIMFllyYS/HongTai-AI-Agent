import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { analysisDocumentSections, observationReportSections, settingsRowGlyphs } from "../apps/web/src/playbook/document-sections";
import { na5IconCells, playbookGlyphs, screenIconCells } from "../apps/web/src/playbook/icon-catalog";
import { playbookSections } from "../apps/web/src/playbook/sections";
import { matchRoute, playbookPath, playbookSectionPath } from "../apps/web/src/router";

const webRoot = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

test("playbook route is a catalog, not a product tab, and does not call AppRuntime", () => {
  assert.equal(playbookPath(), "/playbook");
  assert.equal(matchRoute("/playbook").key, "playbook");
  assert.equal(matchRoute(playbookSectionPath("icons")).key, "playbook");
  assert.deepEqual(matchRoute(playbookSectionPath("icons")).params, { sectionId: "icons" });
  assert.equal(matchRoute("/playbook").navKey, undefined);

  const page = read("playbook/PlaybookPage.tsx");
  const specimens = read("playbook/flow-specimens.tsx");
  assert.doesNotMatch(page, /AppRuntime/);
  assert.doesNotMatch(specimens, /AppRuntime/);
  assert.match(page, /设计稿对照/);
  assert.doesNotMatch(read("navigation/primary-nav.ts"), /playbook/);
  assert.match(specimens, /PlaybookObservingSpecimen/);
  assert.match(specimens, /设计稿标本 · 不是真实观察会话/);
  assert.match(specimens, /标本推理文案，仅用于对照设计稿，不是真实观察/);
  assert.equal(playbookSections.find((section) => section.id === "observing")?.title, "S9b 观察中");
});

test("NA5 and screen Lucide glyphs cover the unarchived pencil icon set", () => {
  assert.equal(na5IconCells.length, 26);
  assert.ok(na5IconCells.every((cell) => playbookGlyphs[cell.name]));
  assert.ok(screenIconCells.every((cell) => playbookGlyphs[cell.name]));
  for (const name of ["scan_face", "layers", "clapperboard", "layout_template", "settings", "sparkles", "plus", "circle_check"] as const) {
    assert.equal(typeof playbookGlyphs[name], "object");
  }
  assert.equal(na5IconCells[0]?.name, "sparkles");
  assert.equal(na5IconCells[0]?.lucide, "wand-sparkles");
  assert.equal(playbookGlyphs.sparkles, playbookGlyphs.wand_sparkles);
  assert.match(read("playbook/icon-catalog.ts"), /sparkles: WandSparkles/);
  const iconSource = read("components/Icon.tsx");
  assert.match(iconSource, /from "\.\.\/playbook\/icon-catalog"/);
  assert.doesNotMatch(iconSource, /from "lucide-react"/);
  assert.doesNotMatch(iconSource, /strokeWidth="1\.8"/);
  assert.match(read("playbook/icon-catalog.ts"), /from "lucide-react"/);
});

test("real pages import playbook section glyphs instead of inventing a second icon language", () => {
  assert.equal(settingsRowGlyphs.ai, "sparkles");
  assert.equal(settingsRowGlyphs.cache, "trash_2");
  assert.equal(settingsRowGlyphs.privacy, "shield");
  assert.equal(analysisDocumentSections.find((item) => item.id === "hook")?.icon, "zap");
  assert.equal(observationReportSections.details.icon, "eye");
  assert.equal(observationReportSections.references.icon, "book_open");

  const settings = read("pages/SettingsPage.tsx");
  assert.match(settings, /settingsRowGlyphs/);
  assert.match(read("components/ContentAnalysisDocument.tsx"), /analysisDocumentSections/);
  assert.match(read("pages/ObservationReportPage.tsx"), /observationReportSections/);
  assert.match(read("navigation/compose-actions.ts"), /icon: "sparkles"/);
  assert.match(read("pages/ApplicationInfoPage.tsx"), /playbookPath\(\)/);
  assert.match(read("pages/ApplicationInfoPage.tsx"), /updateLogSettingsPath\(\)/);
});

test("playbook catalog lists every registered section id", () => {
  const ids = playbookSections.map((section) => section.id);
  assert.deepEqual(ids, ["color", "type", "icons", "tabbar", "navbar", "chrome", "overlay", "skeleton", "paste", "compose", "analysis", "settings", "observing", "observation"]);
  assert.equal(playbookSections.find((section) => section.id === "type")?.summary, "20 / 16 / 15 / 14 / 12 / 11 / 10");
  assert.match(read("styles/shell.css"), /\.page-masthead__titles h1\s*\{[^}]*font-size:\s*var\(--text-display\)[^}]*line-height:\s*var\(--text-display-line\)/s);
  assert.match(read("styles/tokens.css"), /--text-display:\s*1\.25rem/);
});
