import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { activeNavForRoute } from "../apps/web/src/components/BottomNav";
import { matchRoute } from "../apps/web/src/router";

const webRoot = join(process.cwd(), "apps", "web");
const readSource = (relativePath: string) => readFileSync(join(webRoot, "src", relativePath), "utf8");

test("bottom navigation has five slots with a compose plus and no material-library slot", () => {
  const navigation = readSource("components/BottomNav.tsx");
  const styles = readSource("styles/components.css");
  const primaryNav = readSource("navigation/primary-nav.ts");

  assert.doesNotMatch(navigation, /富迪素材库/);
  assert.doesNotMatch(navigation, /setMaterialsOpen/);
  assert.doesNotMatch(navigation, /bottom-nav__item--materials/);
  assert.doesNotMatch(navigation, /material-library-dialog/);
  assert.doesNotMatch(primaryNav, /富迪素材库/);
  assert.match(primaryNav, /label: "观察"/);
  assert.match(primaryNav, /label: "拆解"/);
  assert.doesNotMatch(primaryNav, /id: "create"/);
  assert.match(navigation, /ComposeSheet/);
  assert.match(navigation, /aria-label="新建"/);
  assert.match(styles, /\.bottom-nav\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/s);
  assert.doesNotMatch(styles, /repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(styles, /\.bottom-nav__item--materials/);
});

test("Fudi material library opens from masthead promo and create-page header with token color and reduced-motion stillness", () => {
  const createPage = readSource("pages/CreatePage.tsx");
  const observation = readSource("pages/ObservationStartPage.tsx");
  const home = readSource("pages/TaskHomePage.tsx");
  const templates = readSource("pages/TemplatesPage.tsx");
  const cluster = readSource("components/HomeMastheadActions.tsx");
  const entry = readSource("components/MaterialLibraryHeaderAction.tsx");
  const styles = readSource("styles/components.css");
  const shell = readSource("styles/shell.css");
  const materialPath = join(webRoot, "public", "materials", "fudi-material-library.jpg");
  const promoPath = join(webRoot, "public", "materials", "fudi-library-promo.png");

  assert.equal(existsSync(materialPath), true, "the supplied material image must live under public/materials");
  assert.equal(existsSync(promoPath), true, "the promo sticker must live under public/materials");
  assert.equal((createPage.match(/<MaterialLibraryHeaderAction/g) ?? []).length, 3);
  assert.match(cluster, /<MaterialLibraryHeaderAction/);
  assert.match(cluster, /<HomeProfileAction/);
  assert.match(observation, /<HomeMastheadActions /);
  assert.match(home, /<HomeMastheadActions /);
  assert.match(templates, /<HomeMastheadActions /);
  assert.doesNotMatch(templates, /header-action__button/);
  assert.doesNotMatch(templates, />新建</);
  assert.match(templates, /创建空白模板/);
  assert.match(shell, /\.masthead-actions\s*\{[^}]*display:\s*flex/s);
  assert.match(entry, /<button/);
  assert.match(entry, /aria-label="打开富迪素材库"/);
  assert.match(entry, /type="button"/);
  const overlay = readSource("components/Overlay.tsx");
  assert.match(entry, /<Overlay/);
  assert.match(entry, /placement="center"/);
  assert.match(overlay, /role="dialog"/);
  assert.match(overlay, /aria-modal="true"/);
  assert.match(overlay, /Escape/);
  assert.match(entry, /initialFocusRef/);
  assert.match(entry, /returnFocusRef/);
  assert.match(entry, /\/materials\/fudi-library-promo\.png/);
  assert.match(entry, /material-library-entry__caption/);
  assert.match(entry, /\/materials\/fudi-material-library\.jpg/);
  assert.match(entry, /alt="富迪素材库宣传图"/);
  assert.match(styles, /\.material-library-entry\s*\{[^}]*background:\s*transparent/s);
  assert.match(styles, /\.material-library-entry__caption\s*\{[^}]*background:\s*var\(--color-action-primary\)/s);
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
  assert.match(shellStyles, /\.app-header__action\s*\{[^}]*min-width:\s*2\.75rem/s);
});

test("settings app-info keeps the settings tab active and /publish is not a live route", () => {
  assert.equal(activeNavForRoute("settings-app-info"), "settings");
  assert.equal(activeNavForRoute("settings"), "settings");
  assert.equal(activeNavForRoute("playbook"), "settings");
  assert.equal(matchRoute("/publish").key, "not-found");
});
