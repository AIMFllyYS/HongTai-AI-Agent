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

test("the design logo is shared by brand headers and the AI navigation item", () => {
  assert.equal(existsSync(join(process.cwd(), "apps", "web", "public", "brand", "pulse-flow-mark.svg")), true, "the transparent page mark should be public");
  assert.equal(existsSync(join(process.cwd(), "apps", "web", "public", "brand", "pulse-flow-icon.svg")), true, "the compact design logo should be public");

  const logo = read("components/BrandLogo.tsx");
  const shell = read("components/AppShell.tsx");
  const navigation = read("components/BottomNav.tsx");

  assert.match(logo, /\/brand\/pulse-flow-mark\.svg/);
  assert.match(logo, /\/brand\/pulse-flow-icon\.svg/);
  assert.match(logo, /\/brand\/pulse-flow\.svg/);
  assert.match(logo, /variant\s*=\s*"mark"/);
  assert.match(logo, /alt="宏泰AI智能体 Pulse Flow"/);
  assert.match(shell, /<BrandLogo/);
  assert.match(navigation, /<BrandLogo/);
  assert.doesNotMatch(navigation, /id:\s*"ai"[\s\S]*icon:\s*"smart_toy"/);
});

test("page shells do not repeat the same title as the top app bar", () => {
  for (const relativePath of [
    "pages/AssetsPage.tsx",
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
  assert.match(audit, /page-mark/);
  assert.match(audit, /markWidth/);
  assert.match(audit, /assets geometry/);
  assert.match(audit, /Noto Sans SC/);
  assert.match(audit, /external runtime media/);
});

test("failed assets use a state-specific media treatment", () => {
  const page = read("pages/AssetsPage.tsx");

  assert.match(page, /asset\.kind\s*===\s*"failed"/);
  assert.match(page, /asset-row__media--failed/);
  assert.match(page, /name="error"/);
});
