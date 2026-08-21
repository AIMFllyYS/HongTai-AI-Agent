import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");
const readWorkspace = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), "utf8");

test("asset rows reserve a bounded thumbnail track", () => {
  const libraryStyles = read("styles/pages/library.css");

  assert.match(libraryStyles, /grid-template-columns:\s*minmax\(0,\s*8rem\)\s+minmax\(0,\s*1fr\)\s+auto/);
  assert.match(libraryStyles, /\.asset-row__media\s*\{[\s\S]*min-width:\s*0;/);
  assert.match(libraryStyles, /\.asset-row__media\s*\{[\s\S]*width:\s*100%;/);
  assert.match(libraryStyles, /\.asset-row__media\s*\{[\s\S]*min-height:\s*0;[\s\S]*aspect-ratio:\s*16\s*\/\s*9/);
});

test("the design logo remains a shared asset while primary navigation uses the redesign icons", () => {
  assert.equal(existsSync(join(process.cwd(), "apps", "web", "public", "brand", "pulse-flow-mark.png")), true, "the transparent page mark should be public");
  assert.equal(existsSync(join(process.cwd(), "apps", "web", "public", "brand", "pulse-flow-source.png")), true, "the supplied source should be public");

  const logo = read("components/BrandLogo.tsx");
  const shell = read("components/AppShell.tsx");
  const navigation = read("navigation/primary-nav.ts");
  const bottomNavigation = read("components/BottomNav.tsx");

  assert.match(logo, /\/brand\/pulse-flow-mark\.png/);
  assert.match(logo, /\/brand\/pulse-flow-source\.png/);
  assert.match(logo, /variant\s*=\s*"mark"/);
  assert.match(logo, /alt="宏泰AI智能体 Pulse Flow"/);
  assert.match(shell, /page-masthead/);
  assert.doesNotMatch(shell, /<BrandLogo/);
  assert.doesNotMatch(bottomNavigation, /BrandLogo/);
  assert.match(read("styles/shell.css"), /\.masthead-avatar\s*\{[^}]*width:\s*2\.25rem[^}]*height:\s*2\.25rem[^}]*border:\s*0\.09375rem solid var\(--palette-on-ink\)/s);
  assert.match(navigation, /id:\s*"ai"[\s\S]*icon:\s*"scan_face"/);
  assert.match(bottomNavigation, /bottom-nav__item--\$\{item\.id\}/);
  assert.doesNotMatch(bottomNavigation, /brandLogo/);
});

test("page shells do not repeat the same title as the top app bar", () => {
  for (const relativePath of [
    "pages/TemplatesPage.tsx",
    "pages/CreatePage.tsx",
    "pages/PublishPage.tsx",
    "pages/SettingsPage.tsx",
  ]) {
    assert.doesNotMatch(read(relativePath), /<PageHeading/, `${relativePath} should start with its shell-owned title`);
  }
});

test("the browser audit checks the asset thumbnail boundary and shared logo", () => {
  const audit = readWorkspace("output/playwright/visual_audit.py");

  assert.match(audit, /asset-row/);
  assert.match(audit, /brand-logo/);
  assert.match(audit, /pulse-flow-mark\.png/);
  assert.match(audit, /page-mark/);
  assert.match(audit, /markWidth/);
  assert.match(audit, /bottom-nav__item--ai/);
  assert.match(audit, /assets geometry/);
  assert.match(audit, /Noto Sans SC/);
  assert.match(audit, /external runtime media/);
});

test("template management uses runtime DTOs without fake media status", () => {
  const page = read("pages/TemplatesPage.tsx");

  assert.match(page, /runtime\.templates\.list/);
  assert.match(page, /runtime\.templates\.delete/);
  assert.doesNotMatch(page, /asset\.kind|asset-row__media--failed|StatusBadge|FeatureUnavailablePanel/);
});
