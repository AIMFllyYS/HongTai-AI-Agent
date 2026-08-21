# 2026-08-21 关掉纵向 overscroll 拉伸

## 目标

- 用户可感知的结果：到顶或到底再猛拉时，页面不再整页拉伸、邻页不再露边、松手后不再跟着晃。惯性滚动和左右滑 Tab 仍可用。没有上拉/下拉刷新。

## 允许修改

- `android/app/src/main/java/com/hongtai/aiagent/MainActivity.kt`
- `apps/web/src/styles/foundation.css`、`apps/web/src/styles/shell.css`
- `apps/web/src/hooks/useSwipeNavigation.ts`
- `tests/web-mobile-layout-contract.test.ts`、`tests/web-motion-foundation.test.ts`
- `docs/动效规范.md`、`docs/superpowers/specs/2026-08-07-native-webview-overscroll-shell-design.md`（仅过期声明）、`CHANGELOG.md`、本任务契约

## 明确不做

- 不上拉/下拉刷新、刷新转圈或假进度。
- 不把主滚动改成内部 `overflow: auto`，不自定义 EdgeEffect，不用 JS 弹簧或 `touchmove` preventDefault。
- 不改 `html { scroll-behavior: smooth }`、不推进 `versionName` / `versionCode`、不打 APK。
- 不改 Flow / Schema / Capacitor 组合层 / Overlay / Sheet。
- 不声称真机通过。

## 架构归属

- 所属层：UI（`apps/web`）与 Android WebView 展示配置。
- 禁止跨越：Kotlin 只关 `overScrollMode`，不得决定业务流程或文案。

## 权威状态与数据

- 无新业务 ID。列表健康状态仍靠窄订阅自动更新，失败时才「重新读取」。

## 验收

- 定向测试：`tests/web-mobile-layout-contract.test.ts`、`tests/web-motion-foundation.test.ts`
- 构建 / lint：`pnpm check`、`pnpm --filter @hongtai/web build`
- 浏览器：桌面与约 390px；长页可滚；顶/底再拉不橡皮筋；左右滑 Tab 仍跟手；Sheet 内滚不带动背后页
- 用户实际会看到什么：边界再拉时布局钉死

## 交付说明

- 改了什么：见 CHANGELOG `[未发布]`
- 刻意没有做什么：PTR、嵌套主滚动、版本号、APK
- 剩余风险：WebView stretch 须在物理机或至少 API 35 System WebView 上各猛拉一次顶和底才能关风险；华为 WebView 10 更依赖 Kotlin `OVER_SCROLL_NEVER`。`.route-swipe-viewport` 不得对 Y 轴设 `overscroll-behavior: none`（`overflow-x: hidden` 会吞掉纵向链式滚动）。
