import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { activeNavForRoute } from "../apps/web/src/components/BottomNav";
import { matchRoute } from "../apps/web/src/router";

const webRoot = join(process.cwd(), "apps", "web");
const readSource = (relativePath: string) => readFileSync(join(webRoot, "src", relativePath), "utf8");

test("bottom navigation has five route items and no material-library slot", () => {
  const navigation = readSource("components/BottomNav.tsx");
  const styles = readSource("styles/components.css");
  const primaryNav = readSource("navigation/primary-nav.ts");

  assert.doesNotMatch(navigation, /富迪素材库/);
  assert.doesNotMatch(navigation, /setMaterialsOpen/);
  assert.doesNotMatch(navigation, /bottom-nav__item--materials/);
  assert.doesNotMatch(navigation, /material-library-dialog/);
  assert.doesNotMatch(primaryNav, /富迪素材库/);
  assert.match(styles, /\.bottom-nav\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/s);
  assert.doesNotMatch(styles, /repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(styles, /\.bottom-nav__item--materials/);
});

test("Fudi material library opens from the create-page header with token color and reduced-motion stillness", () => {
  const createPage = readSource("pages/CreatePage.tsx");
  const entry = readSource("components/MaterialLibraryHeaderAction.tsx");
  const styles = readSource("styles/components.css");
  const materialPath = join(webRoot, "public", "materials", "fudi-material-library.jpg");

  assert.equal(existsSync(materialPath), true, "the supplied material image must live under public/materials");
  assert.equal((createPage.match(/headerAction=\{<MaterialLibraryHeaderAction/g) ?? []).length, 3);
  assert.match(entry, /<button/);
  assert.match(entry, /aria-label="打开富迪素材库"/);
  assert.match(entry, /type="button"/);
  assert.match(entry, /role="dialog"/);
  assert.match(entry, /aria-modal="true"/);
  assert.match(entry, /Escape/);
  assert.match(entry, /focus\(/);
  assert.match(entry, /\/materials\/fudi-material-library\.jpg/);
  assert.match(entry, /alt="富迪素材库宣传图"/);
  assert.match(styles, /\.material-library-entry[\s\S]*?background:\s*var\(--color-error-soft\)/);
  assert.match(styles, /\.material-library-entry[\s\S]*?var\(--motion-ease-standard\)/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce[\s\S]*\.material-library-entry[\s\S]*animation:\s*none/);
  assert.doesNotMatch(styles, /\.material-library-entry\s*\{[^}]*#[0-9a-fA-F]{3,8}/s);
});

test("AppShell keeps an empty header-action slot and never renders a inert notification bell", () => {
  const shell = readSource("components/AppShell.tsx");
  const shellStyles = readSource("styles/shell.css");

  assert.match(shell, /className="app-header__action">\{headerAction\}/);
  assert.doesNotMatch(shell, /aria-label="通知"/);
  assert.doesNotMatch(shell, /notifications/);
  assert.match(shellStyles, /\.app-header__action\s*\{[^}]*min-width:\s*2\.5rem/s);
});

test("settings app-info keeps the settings tab active and /publish is not a live route", () => {
  assert.equal(activeNavForRoute("settings-app-info"), "settings");
  assert.equal(activeNavForRoute("settings"), "settings");
  assert.equal(matchRoute("/publish").key, "not-found");
});
