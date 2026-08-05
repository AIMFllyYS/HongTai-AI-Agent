# 移动端交互与动效基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan task-by-task with review checkpoints. Each completed task must pass its stated verification before the next commit.

**Goal:** 在不改变业务接口和现有路由契约的前提下，为 `apps/web` 建立可在未来 APK WebView 中复用的页面过渡、一级导航滑动、点击反馈、音效、触觉和滚动视觉基础。

**Architecture:** 现有 `history.pushState` 仍是唯一路由状态源；`App` 增加单一 `RouteTransition` 包裹，`AppShell` 组合手势和滚动状态，音效/触觉通过 document click 监听和独立 service 边界接入。CSS token 管理时长、缓动、按压和隐藏滚动条，Motion 只负责 React 生命周期和可中断过渡。

**Tech Stack:** React 19, TypeScript, Vite, CSS variables/@layer, `motion@12.43.0`, Web Audio API, `navigator.vibrate`, Node test runner, Playwright/Chromium audit.

---

## Task 1: 固化动效设计规范与依赖边界

**Files:**

- Create: `docs/superpowers/specs/2026-08-05-mobile-interaction-motion-design.md`
- Create: `docs/superpowers/plans/2026-08-05-mobile-interaction-motion.md`
- Modify: `apps/web/package.json`, `pnpm-lock.yaml` only in the dependency task below

- [x] **Step 1: 完成当前仓库、路由、壳、token 和移动端约束审查**

  已确认 `apps/web` 使用 React 19/Vite、手写 `history.pushState`、`AppShell`/`BottomNav` 共享壳、静态 `VisualDataAdapter`，没有现有动画库；`packages/core` 和 CLI 不在本计划修改范围。

- [x] **Step 2: 记录方案取舍**

  设计文档固定采用 `motion` 单库方案；声音和触觉不新增依赖；不做真实刷新、不做内部业务页面的猜测性滑动。

- [x] **Step 3: 提交设计阶段**

  ```powershell
  git add -- docs/superpowers/specs/2026-08-05-mobile-interaction-motion-design.md docs/superpowers/plans/2026-08-05-mobile-interaction-motion.md
  git diff --cached --check
  git commit -m "docs(web): define mobile interaction motion system"
  ```

## Task 2: 写动效基础验收测试并安装唯一动效依赖

**Files:**

- Create: `tests/web-motion-foundation.test.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: 写失败测试**

  测试必须检查以下真实边界：`motion/tokens.ts`、`RouteTransition.tsx`、`useSwipeNavigation.ts`、`useScrollMotion.ts`、`useInteractionFeedback.ts`、`services/interaction-feedback.ts` 尚不存在时测试失败；同时检查 `MotionConfig`、`AnimatePresence`、`navigator.vibrate`、`AudioContext`、`prefers-reduced-motion` 和隐藏滚动条接入点。

- [ ] **Step 2: 运行目标测试确认是预期失败**

  ```powershell
  pnpm exec tsx --test tests/web-motion-foundation.test.ts
  ```

  预期：失败原因是动效基础文件尚未创建，而不是 TypeScript 解析错误。

- [ ] **Step 3: 安装唯一动效库**

  ```powershell
  pnpm --filter @hongtai/web add motion@12.43.0
  ```

  只允许在 `apps/web` 依赖中出现 `motion`，不安装音效、手势、CSS 或状态库。

- [ ] **Step 4: 检查依赖和编码**

  ```powershell
  rg -n '"motion"|@motion' apps/web/package.json pnpm-lock.yaml
  git diff --check
  ```

## Task 3: 建立 token、音效触觉和滚动/滑动原语

**Files:**

- Create: `apps/web/src/motion/tokens.ts`
- Create: `apps/web/src/services/interaction-feedback.ts`
- Create: `apps/web/src/hooks/useInteractionFeedback.ts`
- Create: `apps/web/src/hooks/useSwipeNavigation.ts`
- Create: `apps/web/src/hooks/useScrollMotion.ts`
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/foundation.css`

- [ ] **Step 1: 添加 JS/CSS 同步 token**

  `motion/tokens.ts` 导出 `motionDurations`、`motionEasing`、`routeOffset`；CSS 在 `:root` 导出同名语义变量。JS 只引用数字和 easing 字符串，页面不直接写时长。

- [ ] **Step 2: 实现安全反馈 service**

  导出 `playInteractionFeedback(kind: "press" | "navigate")`。它必须懒创建 `AudioContext`，只播放小于 24ms 的短音；触觉只在 `navigator.vibrate` 存在时调用；所有浏览器 API 失败都被捕获，不得向点击调用方抛错。

- [ ] **Step 3: 实现 document click hook**

  `useInteractionFeedback()` 在挂载时添加 document click listener，识别原生按钮、带 href 的链接、`role="button"` 和 `[data-feedback]`；`data-feedback="none"` 跳过；卸载时移除 listener。`prefers-reduced-motion: reduce` 时不触发声音和触觉。

- [ ] **Step 4: 实现一级导航滑动 hook**

  `useSwipeNavigation(active, navigate)` 返回 `onPointerDown`、`onPointerUp`、`onPointerCancel`。只处理 touch/pen；以 56px 水平阈值和 1.25 倍方向阈值过滤；交互元素和 `[data-no-swipe]` 不触发；仅在五项一级导航中导航到相邻项。

- [ ] **Step 5: 实现滚动观察 hook**

  `useScrollMotion()` 返回 `"top" | "scrolled"`，只用 passive scroll listener 和 requestAnimationFrame 合并更新；初始 SSR 状态为 `top`，不访问不存在的 window。

- [ ] **Step 6: 运行目标测试确认通过**

  ```powershell
  pnpm exec tsx --test tests/web-motion-foundation.test.ts
  pnpm --filter @hongtai/web typecheck
  ```

- [ ] **Step 7: 提交基础原语**

  ```powershell
  git add -- apps/web/package.json pnpm-lock.yaml apps/web/src/motion apps/web/src/services apps/web/src/hooks/useInteractionFeedback.ts apps/web/src/hooks/useSwipeNavigation.ts apps/web/src/hooks/useScrollMotion.ts apps/web/src/styles/tokens.css apps/web/src/styles/foundation.css tests/web-motion-foundation.test.ts
  git diff --cached --check
  git commit -m "feat(web): add mobile interaction primitives"
  ```

## Task 4: 接入 route 过渡和共享壳状态

**Files:**

- Create: `apps/web/src/components/RouteTransition.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/hooks/useBrowserRoute.ts`
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/components/BottomNav.tsx`

- [ ] **Step 1: 为 route 方向写纯函数测试**

  在现有边界测试中增加对 `useBrowserRoute` 返回 `direction` 和相邻一级导航路径的检查；测试只验证公开行为，不启动浏览器。

- [ ] **Step 2: 扩展 `useBrowserRoute`**

  保留 `navigate(path)` 调用兼容性，增加 `direction: "forward" | "backward"` 返回值；pushState 依据当前一级导航/route 位置计算方向，popstate 使用 backward；原有 scroll-to-top 逻辑保留。

- [ ] **Step 3: 实现 `RouteTransition`**

  使用 `AnimatePresence initial={false} mode="wait"` 和唯一 pathname key；进入/退出只动画 opacity 与不超过 16px 的 x 位移；由 `MotionConfig reducedMotion="user"` 统一尊重系统偏好。

- [ ] **Step 4: 让 `App` 单次包裹页面分发**

  将现有 if-return 分发收束到 `renderRoute()`，不改变任何 route、view model 或页面参数；只在最外层增加 `RouteTransition`。所有页面仍通过现有 adapter 取得展示数据。

- [ ] **Step 5: 接入 AppShell 手势和滚动状态**

  `AppShell` 使用两个 hook，把返回的 pointer handlers 放在 `main.app-content`，把 `data-scroll-state` 写到根壳；只在存在一级 `activeNav` 时启用 swipe。底部导航使用 Motion 的 `whileTap`，不修改五项顺序和 path。

- [ ] **Step 6: 运行目标检查并提交**

  ```powershell
  pnpm exec tsx --test tests/web-motion-foundation.test.ts tests/web-shared-boundary.test.ts tests/web-visual-boundary.test.ts
  pnpm --filter @hongtai/web typecheck
  pnpm --filter @hongtai/web build
  git add -- apps/web/src/App.tsx apps/web/src/components/AppShell.tsx apps/web/src/components/BottomNav.tsx apps/web/src/components/RouteTransition.tsx apps/web/src/hooks/useBrowserRoute.ts tests/web-motion-foundation.test.ts tests/web-shared-boundary.test.ts
  git diff --cached --check
  git commit -m "feat(web): add route and navigation motion"
  ```

## Task 5: 接入共享点击视觉、交互卡片和隐藏滚动条

**Files:**

- Modify: `apps/web/src/components/Buttons.tsx`
- Modify: `apps/web/src/components/GlassCard.tsx`
- Modify: `apps/web/src/components/Tabs.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/foundation.css`
- Modify: `apps/web/src/styles/shell.css`
- Modify: `apps/web/src/styles/components.css`

- [ ] **Step 1: 在 App 挂载全局 feedback hook**

  调用一次 `useInteractionFeedback()`；不在页面中复制音效逻辑。

- [ ] **Step 2: 补齐共享控件按压态**

  `Button`、`LinkButton`、`icon-button`、bottom nav、Tabs 和带 `onClick` 的 `GlassCard` 使用同一组 token 驱动的 transform/box-shadow transition；Tabs 保留现有 ARIA 与键盘行为，只为选中项增加短暂的 layout/颜色过渡。

- [ ] **Step 3: 隐藏滚动条但保留滚动**

  在 foundation 统一设置 `scrollbar-width: none` 和 WebKit scrollbar 规则；在 `.app-content` 与横向 scroller 上明确 `touch-action`/`overscroll-behavior`，不得添加 `overflow: hidden` 造成页面不可滚动。

- [ ] **Step 4: 添加壳层滚动抬升样式**

  `.app-shell[data-scroll-state="scrolled"]` 只调整 header 的背景、阴影和边框透明度，不隐藏标题、不移动固定 bottom nav、不覆盖最后一条内容。

- [ ] **Step 5: 运行完整检查并提交**

  ```powershell
  pnpm check
  pnpm --filter @hongtai/web build
  git diff --check
  git add -- apps/web/src/App.tsx apps/web/src/components apps/web/src/styles
  git diff --cached --check
  git commit -m "refactor(web): unify mobile feedback styling"
  ```

## Task 6: 浏览器交互验收、截图和阶段报告

**Files:**

- Modify: `output/playwright/visual_audit.py` only if new checks need a stable selector
- Create: `docs/移动端交互与动效基础验收.md`
- Create/update: `output/playwright/screens/*.png` generated evidence

- [ ] **Step 1: 查看本地测试脚本帮助并复用现有 server**

  ```powershell
  python C:\Users\AIMFl\.codex\skills\webapp-testing\scripts\with_server.py --help
  ```

  当前 5175 预览已存在时，不重复启动服务；用现有 Playwright 审计和一个临时脚本复现交互。

- [ ] **Step 2: 在 390×844 真实浏览器上下文验证**

  访问 `/`、`/vitality/scan`、`/settings`；分别验证底部导航点击、按钮 press class/transform、一级页面右/左滑、纵向滚动后壳层状态、最后内容不被 bottom nav 遮挡和 `prefers-reduced-motion` 降级。记录浏览器是否支持 audio/vibrate，不把桌面不支持当作错误。

- [ ] **Step 3: 运行全 route audit**

  ```powershell
  pnpm check
  pnpm --filter @hongtai/web build
  python output/playwright/visual_audit.py
  ```

  预期：11 个 route、0 page error；检查新增文本没有 UTF-8 replacement character。

- [ ] **Step 4: 写验收报告**

  报告记录页面过渡、滑动、点击、滚动、音触降级、reduced-motion 和明显视觉差异；明确“无真实刷新、无真实业务提交”。

- [ ] **Step 5: 提交验收阶段**

  ```powershell
  git diff --check
  git status --short
  git add -- docs/移动端交互与动效基础验收.md output/playwright/visual_audit.py output/playwright/screens
  git diff --cached --check
  git commit -m "test(web): verify mobile interaction motion"
  ```

## Closeout checklist

- [ ] 所有现有 route 和五项底部导航 path 保持不变。
- [ ] `packages/core`、`packages/platforms`、`packages/ai`、`apps/cli` 和 API/DTO/数据库/任务状态机无修改。
- [ ] 只有一个新增运行时库：`motion`；音效和触觉无第三方依赖。
- [ ] `pnpm check`、Web build 和 Playwright route audit 均通过。
- [ ] click 音效/触觉失败不阻断导航；桌面浏览器差异在报告中明确记录。
- [ ] reduced-motion、隐藏滚动条和底部安全区均有可复现验收证据。
