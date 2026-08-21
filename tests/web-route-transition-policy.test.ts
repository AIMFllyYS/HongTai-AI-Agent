import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { motionDurations, routeOffset } from "../apps/web/src/motion/tokens";

const read = (relativePath: string) => readFileSync(join(process.cwd(), "apps", "web", "src", relativePath), "utf8");

test("secondary page enter is a slow push, not the old 260ms flash", () => {
  assert.equal(motionDurations.page, 720);
  assert.equal(motionDurations.primary, 480);
  assert.equal(motionDurations.overlay, 520);
  assert.equal(routeOffset, 40);
  assert.match(read("components/RouteTransition.tsx"), /motionDurations\.page/);
  assert.match(read("components/RouteTransition.tsx"), /motionDurations\.primary/);
  assert.match(read("hooks/useBrowserRoute.ts"), /transition \?\? "push"/);
  assert.match(read("styles/tokens.css"), /--motion-duration-page:\s*720ms/);
  assert.match(read("styles/tokens.css"), /--motion-distance-page:\s*40px/);
});

test("only the tab bar and avatar use primary; only swipe commit uses instant", () => {
  const nav = read("components/BottomNav.tsx");
  const avatar = read("components/HomeProfileAction.tsx");
  const swipe = read("components/SwipeRouteViewport.tsx");
  const shell = read("components/AppShell.tsx");
  const settings = read("pages/SettingsPage.tsx");
  const history = read("features/tasks/TaskHistory.tsx");
  const observation = read("pages/ObservationStartPage.tsx");
  const compose = read("components/ComposeSheet.tsx");
  const create = read("pages/CreatePage.tsx");
  const detail = read("pages/TaskDetailPage.tsx");
  const report = read("pages/ObservationReportPage.tsx");
  const replica = read("pages/ReplicaWizardPage.tsx");
  const edit = read("pages/ProductionEditPage.tsx");
  const info = read("pages/ApplicationInfoPage.tsx");
  const profile = read("pages/ProfileSettingsPage.tsx");

  assert.match(nav, /transition:\s*["']primary["']/);
  assert.doesNotMatch(nav, /transition:\s*["']instant["']/);
  assert.match(avatar, /transition:\s*["']primary["']/);
  assert.match(swipe, /transition:\s*["']instant["']/);
  assert.doesNotMatch(read("hooks/useSwipeNavigation.ts"), /navigate\(nextPath\)/);

  for (const [name, source] of [
    ["AppShell", shell],
    ["SettingsPage", settings],
    ["TaskHistory", history],
    ["ObservationStartPage", observation],
    ["ComposeSheet", compose],
    ["CreatePage", create],
    ["TaskDetailPage", detail],
    ["ObservationReportPage", report],
    ["ReplicaWizardPage", replica],
    ["ProductionEditPage", edit],
    ["ApplicationInfoPage", info],
    ["ProfileSettingsPage", profile],
  ] as const) {
    assert.doesNotMatch(source, /transition:\s*["']instant["']/, `${name} must not skip the secondary push`);
  }

  assert.match(shell, /navigate\(backPath/);
  assert.match(settings, /profileSettingsPath\(\)/);
  assert.match(settings, /aiSettingsPath\(\)/);
  assert.match(settings, /appInfoSettingsPath\(\)/);
  assert.match(history, /taskDetailPath/);
  assert.match(observation, /observationReportPath/);
  assert.match(compose, /pathForComposeAction/);
});
