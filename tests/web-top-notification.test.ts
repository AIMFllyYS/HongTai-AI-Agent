import assert from "node:assert/strict";
import { test } from "node:test";

import { PausableCountdown } from "../apps/web/src/notifications/notification-countdown";
import {
  NOTIFICATION_DISMISS_DISTANCE_PX,
  NOTIFICATION_DISMISS_VELOCITY_PX_PER_SECOND,
  NOTIFICATION_VISIBLE_MS,
  notificationOpacity,
  shouldDismissNotification,
} from "../apps/web/src/notifications/notification-model";

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
