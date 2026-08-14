import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PausableCountdown } from "../apps/web/src/notifications/notification-countdown";
import {
  NOTIFICATION_DISMISS_DISTANCE_PX,
  NOTIFICATION_DISMISS_VELOCITY_PX_PER_SECOND,
  NOTIFICATION_VISIBLE_MS,
  notificationOpacity,
  shouldDismissNotification,
} from "../apps/web/src/notifications/notification-model";

const webRoot = join(process.cwd(), "apps", "web", "src");
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

test("顶部通知只在向上距离或速度越过阈值时关闭", () => {
  assert.equal(shouldDismissNotification(-NOTIFICATION_DISMISS_DISTANCE_PX - 1, 0), true);
  assert.equal(shouldDismissNotification(0, -NOTIFICATION_DISMISS_VELOCITY_PX_PER_SECOND - 1), true);
  assert.equal(shouldDismissNotification(-12, -120), false);
  assert.equal(shouldDismissNotification(40, 900), false);
});

test("通知向上拖动时逐渐淡出，向下拖动保持不透明", () => {
  assert.equal(notificationOpacity(-60), 0.5);
  assert.equal(notificationOpacity(40), 1);
});

test("通知拖拽暂停计时，回弹后继续剩余时间", () => {
  let now = 0;
  let scheduledDelay = 0;
  let scheduled: (() => void) | undefined;
  let elapsed = 0;
  const clock = {
    now: () => now,
    schedule: (callback: () => void, delayMs: number) => {
      scheduled = callback;
      scheduledDelay = delayMs;
      return 1;
    },
    cancel: () => { scheduled = undefined; },
  };
  const countdown = new PausableCountdown(NOTIFICATION_VISIBLE_MS, () => { elapsed += 1; }, clock);

  countdown.start();
  now = 1_200;
  countdown.pause();
  assert.equal(countdown.remainingMs, 3_800);
  now = 9_000;
  countdown.resume();
  assert.equal(scheduledDelay, 3_800);
  scheduled?.();
  assert.equal(elapsed, 1);
});

test("全局通知宿主只维护一条通知并渲染顶部组件", () => {
  assert.equal(existsSync(join(webRoot, "notifications", "NotificationProvider.tsx")), true);
  const provider = read("notifications/NotificationProvider.tsx");
  assert.match(provider, /NotificationContext/);
  assert.match(provider, /setCurrent/);
  assert.match(provider, /<TopNotification/);
});

test("顶部通知使用 Motion、5 秒倒计时和向上拖拽关闭", () => {
  const component = read("components/TopNotification.tsx");
  assert.match(component, /AnimatePresence/);
  assert.match(component, /drag="y"/);
  assert.match(component, /PausableCountdown/);
  assert.match(component, /shouldDismissNotification/);
  assert.match(component, /notificationOpacity/);
  assert.match(component, /dragElastic=\{\{ top: 1, bottom: 0\.12 \}\}/);
  assert.match(component, /onDragStart/);
  assert.match(component, /onDragEnd/);
  assert.doesNotMatch(component, /notification\.technicalCode/);
  assert.doesNotMatch(component, /top-notification__technical-code/);
});

test("顶部通知样式使用安全区、圆角和非阻断悬浮层", () => {
  const css = read("styles/components.css");
  assert.match(css, /\.top-notification-viewport[\s\S]*env\(safe-area-inset-top\)/);
  assert.match(css, /\.top-notification[\s\S]*border-radius:/);
  assert.match(css, /\.top-notification-viewport[\s\S]*pointer-events:\s*none/);
  assert.match(css, /\.top-notification[\s\S]*pointer-events:\s*auto/);
});

test("生产入口只挂载一个全局通知 Provider，旧错误卡片样式已删除", () => {
  const main = read("main.tsx");
  const settings = read("styles/pages/settings.css");
  assert.match(main, /NotificationProvider/);
  assert.match(main, /<NotificationProvider>[\s\S]*<RuntimeBootstrap \/>[\s\S]*<\/NotificationProvider>/);
  assert.doesNotMatch(settings, /\.issue-notice/);
});
