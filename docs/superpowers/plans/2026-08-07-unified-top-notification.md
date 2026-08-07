# 全局顶部通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一套全局圆角顶部通知，支持 5 秒自动收回、向上拖拽关闭、未达阈值回弹，并让现有页面错误统一通过该通知展示。

**Architecture:** 在 React 根节点挂载单一 `NotificationProvider`，由纯 TypeScript 模型负责倒计时和手势阈值，由 `TopNotification` 只负责 Motion 渲染与指针交互。保留现有页面对 `IssueNotice` 的调用，将其改为无 DOM 的通知适配器，避免逐页重写和两套并行错误视觉。

**Tech Stack:** React 19、TypeScript、Motion 12、CSS 设计令牌、Node `node:test`、Vite、Capacitor 8。

---

## 文件结构

- Create: `apps/web/src/notifications/notification-model.ts` — 通知类型、固定时长、拖拽阈值和纯计算函数。
- Create: `apps/web/src/notifications/notification-countdown.ts` — 可暂停、恢复、销毁的 5 秒倒计时。
- Create: `apps/web/src/notifications/NotificationProvider.tsx` — 全局单通知状态及 `show/dismiss` 接口。
- Create: `apps/web/src/components/TopNotification.tsx` — 顶部圆角小窗、进入/退出动画和拖拽交互。
- Modify: `apps/web/src/components/IssueNotice.tsx` — 保留既有错误动作映射，改为向全局通知层发送消息并返回 `null`。
- Modify: `apps/web/src/main.tsx` — 在应用组合根挂载 `NotificationProvider`。
- Modify: `apps/web/src/styles/components.css` — 新增唯一通知视觉与安全区样式。
- Modify: `apps/web/src/styles/pages/settings.css` — 删除旧 `.issue-notice` 大卡片样式。
- Create: `tests/web-top-notification.test.ts` — 纯逻辑、组件边界和全局挂载测试。
- Modify: `tests/web-issue-notice.test.ts` — 将旧页面卡片断言改为全局通知适配器断言。

### Task 1: 通知模型与可暂停倒计时

**Files:**
- Create: `apps/web/src/notifications/notification-model.ts`
- Create: `apps/web/src/notifications/notification-countdown.ts`
- Create: `tests/web-top-notification.test.ts`

- [ ] **Step 1: 写手势和倒计时失败测试**

在 `tests/web-top-notification.test.ts` 写入：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { PausableCountdown } from "../apps/web/src/notifications/notification-countdown";
import {
  NOTIFICATION_DISMISS_DISTANCE_PX,
  NOTIFICATION_DISMISS_VELOCITY_PX_PER_SECOND,
  NOTIFICATION_VISIBLE_MS,
  notificationDragPresentation,
  shouldDismissNotification,
} from "../apps/web/src/notifications/notification-model";

test("顶部通知只在向上距离或速度越过阈值时关闭", () => {
  assert.equal(shouldDismissNotification(-NOTIFICATION_DISMISS_DISTANCE_PX - 1, 0), true);
  assert.equal(shouldDismissNotification(0, -NOTIFICATION_DISMISS_VELOCITY_PX_PER_SECOND - 1), true);
  assert.equal(shouldDismissNotification(-12, -120), false);
  assert.equal(shouldDismissNotification(40, 900), false);
});

test("通知向上跟手并淡出，向下拖动只保留阻尼", () => {
  assert.deepEqual(notificationDragPresentation(-60), { y: -60, opacity: 0.5 });
  assert.deepEqual(notificationDragPresentation(40), { y: 6, opacity: 1 });
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
```

- [ ] **Step 2: 运行测试并确认因缺少模块失败**

Run: `pnpm exec tsx --test tests/web-top-notification.test.ts`

Expected: FAIL，错误包含 `Cannot find module '../apps/web/src/notifications/notification-model'`。

- [ ] **Step 3: 实现最小通知模型**

创建 `apps/web/src/notifications/notification-model.ts`：

```ts
export type NotificationLevel = "success" | "info" | "warning" | "error";

export interface NotificationAction {
  readonly label: string;
  readonly onPress: () => void;
}

export interface NotificationInput {
  readonly level: NotificationLevel;
  readonly title: string;
  readonly message?: string;
  readonly technicalCode?: string;
  readonly action?: NotificationAction;
}

export interface AppNotification extends NotificationInput {
  readonly id: string;
}

export const NOTIFICATION_VISIBLE_MS = 5_000;
export const NOTIFICATION_DISMISS_DISTANCE_PX = 36;
export const NOTIFICATION_DISMISS_VELOCITY_PX_PER_SECOND = 450;

export function shouldDismissNotification(deltaY: number, velocityY: number): boolean {
  return deltaY < -NOTIFICATION_DISMISS_DISTANCE_PX || velocityY < -NOTIFICATION_DISMISS_VELOCITY_PX_PER_SECOND;
}

export function notificationDragPresentation(deltaY: number): { readonly y: number; readonly opacity: number } {
  if (deltaY >= 0) return { y: Math.round(deltaY * 0.15), opacity: 1 };
  return { y: deltaY, opacity: Math.max(0.25, 1 - Math.abs(deltaY) / 120) };
}
```

- [ ] **Step 4: 实现可暂停倒计时**

创建 `apps/web/src/notifications/notification-countdown.ts`：

```ts
export interface CountdownClock {
  readonly now: () => number;
  readonly schedule: (callback: () => void, delayMs: number) => unknown;
  readonly cancel: (handle: unknown) => void;
}

const browserClock: CountdownClock = {
  now: () => performance.now(),
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (handle) => window.clearTimeout(handle as number),
};

export class PausableCountdown {
  readonly #durationMs: number;
  readonly #onElapsed: () => void;
  readonly #clock: CountdownClock;
  #remainingMs: number;
  #startedAt: number | undefined;
  #handle: unknown;

  constructor(durationMs: number, onElapsed: () => void, clock: CountdownClock = browserClock) {
    this.#durationMs = durationMs;
    this.#remainingMs = durationMs;
    this.#onElapsed = onElapsed;
    this.#clock = clock;
  }

  get remainingMs(): number {
    if (this.#startedAt === undefined) return this.#remainingMs;
    return Math.max(0, this.#remainingMs - (this.#clock.now() - this.#startedAt));
  }

  start(): void {
    this.dispose();
    this.#remainingMs = this.#durationMs;
    this.#schedule();
  }

  pause(): void {
    if (this.#startedAt === undefined) return;
    this.#remainingMs = this.remainingMs;
    this.#clearHandle();
  }

  resume(): void {
    if (this.#startedAt !== undefined || this.#remainingMs <= 0) return;
    this.#schedule();
  }

  dispose(): void {
    this.#clearHandle();
  }

  #schedule(): void {
    this.#startedAt = this.#clock.now();
    this.#handle = this.#clock.schedule(() => {
      this.#handle = undefined;
      this.#startedAt = undefined;
      this.#remainingMs = 0;
      this.#onElapsed();
    }, this.#remainingMs);
  }

  #clearHandle(): void {
    if (this.#handle !== undefined) this.#clock.cancel(this.#handle);
    this.#handle = undefined;
    this.#startedAt = undefined;
  }
}
```

- [ ] **Step 5: 运行测试并确认通过**

Run: `pnpm exec tsx --test tests/web-top-notification.test.ts`

Expected: 3 tests PASS。

- [ ] **Step 6: 提交纯逻辑阶段**

```powershell
git add -- apps/web/src/notifications/notification-model.ts apps/web/src/notifications/notification-countdown.ts tests/web-top-notification.test.ts
git diff --cached --check
git commit -m "feat(web): add notification lifecycle model"
```

### Task 2: 全局通知宿主与圆角拖拽组件

**Files:**
- Create: `apps/web/src/notifications/NotificationProvider.tsx`
- Create: `apps/web/src/components/TopNotification.tsx`
- Modify: `apps/web/src/styles/components.css`
- Modify: `tests/web-top-notification.test.ts`

- [ ] **Step 1: 为组件边界写失败测试**

在 `tests/web-top-notification.test.ts` 追加：

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const webRoot = join(process.cwd(), "apps", "web", "src");
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

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
  assert.match(component, /onDragStart/);
  assert.match(component, /onDragEnd/);
});

test("顶部通知样式使用安全区、圆角和非阻断悬浮层", () => {
  const css = read("styles/components.css");
  assert.match(css, /\.top-notification-viewport[\s\S]*env\(safe-area-inset-top\)/);
  assert.match(css, /\.top-notification[\s\S]*border-radius:/);
  assert.match(css, /\.top-notification-viewport[\s\S]*pointer-events:\s*none/);
  assert.match(css, /\.top-notification[\s\S]*pointer-events:\s*auto/);
});
```

- [ ] **Step 2: 运行测试并确认组件不存在而失败**

Run: `pnpm exec tsx --test tests/web-top-notification.test.ts`

Expected: 新增的 3 tests FAIL，原因是 Provider 与组件文件不存在。

- [ ] **Step 3: 创建全局通知 Provider**

创建 `apps/web/src/notifications/NotificationProvider.tsx`：

```tsx
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { PropsWithChildren } from "react";

import { TopNotification } from "../components/TopNotification";
import type { AppNotification, NotificationInput } from "./notification-model";

interface NotificationContextValue {
  readonly show: (input: NotificationInput) => string;
  readonly dismiss: (id?: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

export function NotificationProvider({ children }: PropsWithChildren) {
  const [current, setCurrent] = useState<AppNotification>();
  const sequence = useRef(0);
  const show = useCallback((input: NotificationInput) => {
    const id = `notice-${++sequence.current}`;
    setCurrent({ ...input, id });
    return id;
  }, []);
  const dismiss = useCallback((id?: string) => {
    setCurrent((value) => (!id || value?.id === id ? undefined : value));
  }, []);
  const value = useMemo(() => ({ show, dismiss }), [dismiss, show]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <TopNotification notification={current} onDismiss={dismiss} />
    </NotificationContext.Provider>
  );
}

export function useNotification(): NotificationContextValue {
  const value = useContext(NotificationContext);
  if (!value) throw new Error("NotificationProvider is not mounted");
  return value;
}
```

- [ ] **Step 4: 创建圆角通知与拖拽交互**

创建 `apps/web/src/components/TopNotification.tsx`，实现以下完整结构：

```tsx
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef } from "react";

import { Icon } from "./Icon";
import { PausableCountdown } from "../notifications/notification-countdown";
import {
  NOTIFICATION_VISIBLE_MS,
  shouldDismissNotification,
  type AppNotification,
  type NotificationLevel,
} from "../notifications/notification-model";

const iconForLevel: Readonly<Record<NotificationLevel, "check_circle" | "info" | "error">> = {
  success: "check_circle",
  info: "info",
  warning: "error",
  error: "error",
};

export interface TopNotificationProps {
  readonly notification?: AppNotification;
  readonly onDismiss: (id?: string) => void;
}

export function TopNotification({ notification, onDismiss }: TopNotificationProps) {
  const reducedMotion = useReducedMotion();
  const countdown = useRef<PausableCountdown | undefined>(undefined);
  const dragY = useMotionValue(0);
  const dragOpacity = useTransform(dragY, [-120, 0], [0.25, 1]);

  useEffect(() => {
    if (!notification) return undefined;
    dragY.set(0);
    const next = new PausableCountdown(NOTIFICATION_VISIBLE_MS, () => onDismiss(notification.id));
    countdown.current = next;
    next.start();
    return () => {
      next.dispose();
      countdown.current = undefined;
    };
  }, [dragY, notification, onDismiss]);

  const runAction = () => {
    if (!notification?.action) return;
    try {
      notification.action.onPress();
    } finally {
      onDismiss(notification.id);
    }
  };

  return (
    <AnimatePresence>
      {notification ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="top-notification-viewport"
          exit={{ opacity: 0, y: reducedMotion ? -8 : "-140%" }}
          initial={{ opacity: 0, y: reducedMotion ? -8 : "-140%" }}
          key={notification.id}
          transition={{ duration: reducedMotion ? 0.14 : 0.4, ease: [0.22, 0.86, 0.28, 1] }}
        >
          <motion.aside
            aria-live={notification.level === "error" ? "assertive" : "polite"}
            className={`top-notification top-notification--${notification.level}`}
            data-technical-code={notification.technicalCode}
            drag={reducedMotion ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 1, bottom: 0.12 }}
            onDragEnd={(_event, info) => {
              if (shouldDismissNotification(info.offset.y, info.velocity.y)) {
                onDismiss(notification.id);
                return;
              }
              void animate(dragY, 0, { type: "spring", stiffness: 520, damping: 38 });
              countdown.current?.resume();
            }}
            onDragStart={() => countdown.current?.pause()}
            role={notification.level === "error" ? "alert" : "status"}
            style={{ opacity: dragOpacity, y: dragY }}
          >
            <span className="top-notification__icon"><Icon name={iconForLevel[notification.level]} size={19} /></span>
            <span className="top-notification__copy">
              <strong>{notification.title}</strong>
              {notification.message ? <small>{notification.message}</small> : null}
            </span>
            {notification.action ? (
              <button className="top-notification__action" onClick={runAction} onPointerDown={(event) => event.stopPropagation()} type="button">
                {notification.action.label}
              </button>
            ) : null}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
```

- [ ] **Step 5: 添加唯一通知样式**

在 `apps/web/src/styles/components.css` 追加 `.top-notification-viewport`、`.top-notification`、四种状态修饰符、图标、文案和操作按钮样式。固定要求如下：

```css
.top-notification-viewport {
  position: fixed;
  top: calc(env(safe-area-inset-top) + var(--space-2));
  right: 0;
  left: 0;
  z-index: 80;
  display: flex;
  justify-content: center;
  padding-inline: 0.875rem;
  pointer-events: none;
}

.top-notification {
  display: grid;
  width: min(100%, 26rem);
  grid-template-columns: 2.375rem minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3);
  color: var(--color-text-primary);
  touch-action: pan-x;
  pointer-events: auto;
  user-select: none;
  background: rgba(255, 255, 253, 0.97);
  border: 1px solid var(--color-outline-soft);
  border-radius: 1.1875rem;
  box-shadow: 0 0.875rem 2.625rem rgba(27, 59, 50, 0.18), 0 0.125rem 0.5rem rgba(27, 59, 50, 0.07);
  backdrop-filter: blur(1.125rem);
}

.top-notification__icon {
  display: grid;
  width: 2.375rem;
  height: 2.375rem;
  place-items: center;
  border-radius: 0.8125rem;
}

.top-notification--success .top-notification__icon { color: var(--color-success); background: var(--color-success-soft); }
.top-notification--info .top-notification__icon { color: var(--color-progress); background: var(--color-progress-soft); }
.top-notification--warning .top-notification__icon { color: var(--color-warning); background: var(--color-warning-soft); }
.top-notification--error .top-notification__icon { color: var(--color-error); background: var(--color-error-soft); }

.top-notification__copy { display: grid; min-width: 0; gap: 0.1875rem; }
.top-notification__copy strong { font-size: var(--text-caption); line-height: 1.35; }
.top-notification__copy small { overflow: hidden; color: var(--color-text-muted); font-size: var(--text-meta); line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.top-notification__action { padding: 0.45rem 0.7rem; color: var(--color-primary-strong); background: var(--color-accent-soft); border-radius: var(--radius-pill); font-size: var(--text-meta); font-weight: 700; }
```

- [ ] **Step 6: 运行目标测试与类型检查**

Run: `pnpm exec tsx --test tests/web-top-notification.test.ts`

Expected: 6 tests PASS。

Run: `pnpm --filter @hongtai/web typecheck`

Expected: PASS，无 TypeScript 错误。

- [ ] **Step 7: 提交通知组件阶段**

```powershell
git add -- apps/web/src/notifications/NotificationProvider.tsx apps/web/src/components/TopNotification.tsx apps/web/src/styles/components.css tests/web-top-notification.test.ts
git diff --cached --check
git commit -m "feat(web): add draggable top notification"
```

### Task 3: 将现有 IssueNotice 接入全局通知

**Files:**
- Modify: `apps/web/src/components/IssueNotice.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/styles/pages/settings.css`
- Modify: `tests/web-issue-notice.test.ts`
- Modify: `tests/web-top-notification.test.ts`

- [ ] **Step 1: 写全局挂载和旧卡片移除的失败测试**

把 `tests/web-issue-notice.test.ts` 第一项中的 DOM 属性断言替换为：

```ts
  const source = read("components/IssueNotice.tsx");
  assert.match(source, /useNotification/);
  assert.match(source, /return null/);
  assert.doesNotMatch(source, /GlassCard/);
  assert.doesNotMatch(source, /issue\.code\s*===/);
```

并在 `tests/web-top-notification.test.ts` 追加：

```ts
test("生产入口只挂载一个全局通知 Provider，旧错误卡片样式已删除", () => {
  const main = read("main.tsx");
  const settings = read("styles/pages/settings.css");
  assert.match(main, /NotificationProvider/);
  assert.match(main, /<NotificationProvider>[\s\S]*<RuntimeBootstrap \/>[\s\S]*<\/NotificationProvider>/);
  assert.doesNotMatch(settings, /\.issue-notice/);
});
```

- [ ] **Step 2: 运行测试并确认仍渲染旧卡片而失败**

Run: `pnpm exec tsx --test tests/web-issue-notice.test.ts tests/web-top-notification.test.ts`

Expected: FAIL，指出缺少 `useNotification`、`NotificationProvider`，且旧 `.issue-notice` 样式仍存在。

- [ ] **Step 3: 把 IssueNotice 改成无 DOM 通知适配器**

保留 `TaskIssueActionHandlers`、`actionDescriptors` 与 `issueActionPresentation()`，只替换组件实现及导入：

```tsx
import { useEffect, useRef } from "react";
import type { TaskIssue } from "@hongtai/core";

import { useNotification } from "../notifications/NotificationProvider";

export function IssueNotice({ issue, actions }: IssueNoticeProps) {
  const { show } = useNotification();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const presentation = issueActionPresentation(issue.action, actionsRef.current);
    show({
      level: issue.severity === "error" ? "error" : "warning",
      title: issue.userMessage,
      message: presentation.guidance,
      technicalCode: issue.code,
      ...(presentation.label && presentation.onAction
        ? { action: { label: presentation.label, onPress: presentation.onAction } }
        : {}),
    });
  }, [issue.action, issue.code, issue.severity, issue.userMessage, show]);

  return null;
}
```

- [ ] **Step 4: 在生产组合根挂载 Provider**

在 `apps/web/src/main.tsx` 导入 `NotificationProvider`，并把最终渲染改为：

```tsx
createRoot(root).render(
  <StrictMode>
    <NotificationProvider>
      <RuntimeBootstrap />
    </NotificationProvider>
  </StrictMode>,
);
```

- [ ] **Step 5: 删除旧页面错误卡片样式**

从 `apps/web/src/styles/pages/settings.css` 删除从 `.issue-notice {` 开始，到 `.issue-notice .button { ... }` 结束的整组样式。不要保留隐藏版 `.issue-notice`，避免两套视觉规范并存。

- [ ] **Step 6: 运行两组目标测试和 Web 构建**

Run: `pnpm exec tsx --test tests/web-issue-notice.test.ts tests/web-top-notification.test.ts`

Expected: 所有目标 tests PASS。

Run: `pnpm --filter @hongtai/web build`

Expected: Vite production build PASS，无 CSS 或 TypeScript 错误。

- [ ] **Step 7: 提交全局接入阶段**

```powershell
git add -- apps/web/src/components/IssueNotice.tsx apps/web/src/main.tsx apps/web/src/styles/pages/settings.css tests/web-issue-notice.test.ts tests/web-top-notification.test.ts
git diff --cached --check
git commit -m "refactor(web): route page issues through top notification"
```

### Task 4: 全量验证与 APK 装配检查

**Files:**
- Verify only; do not add unrelated generated files.

- [ ] **Step 1: 运行 UTF-8 和替换字符扫描**

Run:

```powershell
$replacement = [char]0xFFFD
$files = @(
  'apps/web/src/notifications/notification-model.ts',
  'apps/web/src/notifications/notification-countdown.ts',
  'apps/web/src/notifications/NotificationProvider.tsx',
  'apps/web/src/components/TopNotification.tsx',
  'apps/web/src/components/IssueNotice.tsx',
  'tests/web-top-notification.test.ts'
)
$found = Select-String -Path $files -Pattern $replacement -SimpleMatch
if ($found) { $found; exit 1 }
```

Expected: 无输出，exit code 0。

- [ ] **Step 2: 运行全量自动门禁**

Run: `pnpm check`

Expected: typecheck、ESLint 与全部根测试 PASS。

- [ ] **Step 3: 构建并同步 Web 资产到 Android**

Run: `pnpm --filter @hongtai/web build`

Expected: Vite production build PASS。

Run: `pnpm exec cap sync android`

Expected: Capacitor 8 sync PASS；`.env` 未复制到 Web 或 Android 资产。

- [ ] **Step 4: 构建 debug APK**

Run from `android/`: `.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug`

Expected: `BUILD SUCCESSFUL`，APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。

- [ ] **Step 5: 检查工作区与阶段边界**

Run:

```powershell
git status --short
git diff --check
git log -4 --oneline
```

Expected: 除 `.superpowers/` 可视化草稿目录外无未提交产品源码；最近三次实现提交依次覆盖纯逻辑、通知组件和页面接入。

- [ ] **Step 6: 真机验收记录**

在物理 Android 设备上触发一个真实页面错误，确认：顶部圆角小窗下滑出现；停留 5 秒后向上缓动收回；向上拖动超过阈值会关闭；轻微拖动会回弹并继续剩余时间；操作按钮只执行一次。

若当前环境没有 ADB 或物理设备，明确记录为“自动构建通过、真机交互待验收”，不得声称真机通过。
