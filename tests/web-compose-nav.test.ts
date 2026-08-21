import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { activeNavForRoute } from "../apps/web/src/components/BottomNav";
import {
  composeActions,
  composeEntryFromSearch,
  pasteIntentFromSearch,
  pathForComposeAction,
} from "../apps/web/src/navigation/compose-actions";
import { adjacentPrimaryNavPath, primaryNavItems } from "../apps/web/src/navigation/primary-nav";
import { pathForRoute } from "../apps/web/src/router";

const read = (relativePath: string) => readFileSync(join(process.cwd(), "apps", "web", "src", relativePath), "utf8");

test("加号三项只指向已接入的真实入口", () => {
  assert.deepEqual(composeActions.map((item) => item.id), ["agent", "replica", "paste"]);
  assert.equal(composeActions[0]?.title, "智能成片");
  assert.equal(composeActions[0]?.description, "AI 写旁白与字幕，导入素材即可");
  assert.equal(composeActions[1]?.title, "爆款复刻");
  assert.equal(composeActions[1]?.description, "按分镜清单逐项拍摄");
  assert.equal(composeActions[2]?.title, "拆解新链接");
  assert.equal(composeActions[2]?.description, "粘贴链接开始分析");
  assert.equal(composeActions[0]?.icon, "sparkles");
  assert.equal(composeActions[1]?.icon, "list_checks");
  assert.equal(composeActions[2]?.icon, "link");
  assert.equal(pathForComposeAction("agent"), `${pathForRoute("create")}?entry=agent`);
  assert.equal(pathForComposeAction("replica"), `${pathForRoute("create")}?entry=replica`);
  assert.equal(pathForComposeAction("paste"), `${pathForRoute("home")}?intent=paste`);
});

test("compose search helpers only accept the known entry and paste intent", () => {
  assert.equal(composeEntryFromSearch("?entry=agent"), "agent");
  assert.equal(composeEntryFromSearch("entry=replica"), "replica");
  assert.equal(composeEntryFromSearch("?entry=avatar"), "");
  assert.equal(composeEntryFromSearch("?sourceId=task-1"), "");
  assert.equal(pasteIntentFromSearch("?intent=paste"), true);
  assert.equal(pasteIntentFromSearch("?intent=share"), false);
});

test("sliding covers four tabs and leaves create on the plus", () => {
  assert.deepEqual(primaryNavItems.map((item) => item.id), ["ai", "home", "templates", "settings"]);
  assert.equal(adjacentPrimaryNavPath("home", "previous"), pathForRoute("observation-new"));
  assert.equal(adjacentPrimaryNavPath("home", "next"), pathForRoute("templates"));
  assert.equal(adjacentPrimaryNavPath("create", "next"), undefined);
  assert.equal(adjacentPrimaryNavPath("create", "previous"), undefined);
  assert.equal(activeNavForRoute("create"), "create");
  assert.equal(activeNavForRoute("production-edit"), "create");
  assert.equal(activeNavForRoute("replica-wizard"), "create");
});

test("compose sheet, home paste intent, and create swipe lock stay wired", () => {
  const sheet = read("components/ComposeSheet.tsx");
  const home = read("pages/TaskHomePage.tsx");
  const swipe = read("hooks/useSwipeNavigation.ts");
  const nav = read("components/BottomNav.tsx");
  const styles = read("styles/components.css");

  assert.match(sheet, /title="新建"/);
  assert.match(sheet, /size=\{16\}/);
  assert.match(sheet, />取消</);
  assert.match(home, /consumePasteIntentFromSearch/);
  assert.match(home, /variant="segmented"/);
  assert.match(home, /HomeMastheadActions/);
  assert.match(swipe, /active === "create"/);
  assert.match(nav, /aria-label="新建"/);
  assert.match(styles, /\.sheet-action__icon\s*\{[^}]*width:\s*2\.125rem[^}]*height:\s*2\.125rem[^}]*border-radius:\s*50%/s);
  assert.match(styles, /\.sheet-action__icon\s*\{[^}]*color:\s*var\(--palette-brand-deep\)/s);
  assert.match(styles, /\.bottom-nav__item\s*\{[^}]*justify-content:\s*center[^}]*padding:\s*0/s);
  assert.match(styles, /\.bottom-nav__plus\s*\{[^}]*width:\s*2rem[^}]*height:\s*2rem[^}]*border-radius:\s*50%/s);
  assert.doesNotMatch(styles, /\.bottom-nav__item\s*\{[^}]*padding:\s*0\.75rem 0 0/s);
});
