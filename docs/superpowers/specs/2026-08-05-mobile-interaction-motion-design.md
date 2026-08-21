# 移动端交互与动效基础设计

> 状态：**已被 [动效规范](../../动效规范.md) 取代**。本文是 2026-08-05 快照；Sheet 手势、骨架屏、底栏点击缓动以活文档和源码为准。
>
> 范围：`apps/web` 的静态视觉基础、路由过渡、一级页面滑动、点击反馈、音效与触觉降级边界

## 1. 目标与边界

宏泰 AI 智能体最终会进入 Android WebView/APK，因此动效必须服务于触摸、连续滚动、可读性和弱网络/离线资源边界。此次只补齐前端基础交互，不接入真实 CLI、API、任务订阅、诊疗规则、权限或任何新的业务状态。

本次交互的真实语义只定义到以下层级：

- 点击可交互控件：给予短促的视觉压下、可选的短音和触觉反馈；
- 页面切换：在现有 route 之间做快速淡入和轻微水平位移；
- 一级页面左右滑动：只在 AI、拆解、制作、素材、设置五项一级导航之间切换；
- 页面纵向滚动：保留浏览器原生惯性，只增加滚动后的轻微壳层抬升；
- 不实现“下拉刷新数据”，因为当前没有真实数据刷新契约。

## 2. 方案比较与决策

### 方案 A：纯 CSS + 自建 Web Animations

依赖最少，适合按钮和卡片状态；但 React 页面退出动画、连续 route 切换和手势中断需要自行维护，容易与现有路由分发重复耦合。

### 方案 B：Motion for React + CSS token（采用）

新增一个 `motion` 依赖，使用 `AnimatePresence` 管理页面进入/退出，使用 `whileTap`/`layoutId` 提供可中断的共享交互；按钮、滚动条和主题仍由现有 CSS token 控制。官方文档明确支持 React 组件进入/退出动画、手势和 `reducedMotion` 配置，页面不支持时可自然退化为普通 DOM 更新。

### 方案 C：React Spring/手势套件组合

物理手感更强，但会引入多个职责重叠的库和更高的长期维护成本；当前没有需要复杂拖拽或时间轴的业务，不采用。

最终决策：使用 `motion@12.43.0`，不引入音效包、触觉包、CSS 框架或新的状态库。音效使用原生 Web Audio，触觉使用 `navigator.vibrate`，都必须捕获异常并静默降级。

## 3. 动效规范

### 3.1 时间与缓动

CSS 与 TypeScript 共享同一组语义 token；CSS 使用 `cubic-bezier()` 字符串，Motion 使用同一曲线对应的四元数组：

| Token | 值 | 用途 |
| --- | ---: | --- |
| `--motion-duration-instant` | 80ms | 触摸即时视觉确认 |
| `--motion-duration-fast` | 140ms | 按钮、导航、卡片压下 |
| `--motion-duration-standard` | 220ms | tab/局部状态切换 |
| `--motion-duration-page` | 260ms | route 进入/退出 |
| `--motion-ease-standard` | `cubic-bezier(.2, 0, 0, 1)` | 常规 UI 变化 |
| `--motion-ease-emphasized` | `cubic-bezier(.2, .8, .2, 1)` | 页面进入与抬升 |
| `--motion-scale-press` | `.98` | 普通控件压下 |

动效只优先动画 `transform`、`opacity`、`box-shadow` 和颜色，不对布局尺寸做连续动画；页面切换最多使用 16px 的水平位移，避免在小屏幕上造成晕动感。

### 3.2 页面切换

现有 `useBrowserRoute` 继续作为唯一导航状态源。`App` 只把当前 path 和方向交给 `RouteTransition`：

```tsx
<MotionConfig reducedMotion="user">
  <AnimatePresence initial={false} mode="wait" custom={direction}>
    <motion.div key={pathname} className="route-transition" />
  </AnimatePresence>
</MotionConfig>
```

普通前进为从右侧轻微进入，后退为从左侧轻微进入；退出同时淡出。连续点击由 `mode="wait"` 收敛为一次短过渡，不改变数据或业务状态。

### 3.3 滑动

`useSwipeNavigation` 只在 `activeNav` 属于五项一级导航时启用，使用 Pointer Events 记录触摸/手写笔的起点和终点：水平距离至少 56px、水平距离大于垂直距离的 1.25 倍，才触发相邻一级 route。鼠标拖动不触发；输入框、按钮、链接、选择器和 `[data-no-swipe]` 区域不触发。纵向滚动继续交给浏览器，内容区域声明 `touch-action: pan-y`。

### 3.4 点击、音效和触觉

`useInteractionFeedback` 在 `App` 层监听真实 click 事件，只处理 `button`、带 href 的 `a`、`role="button"` 和显式 `[data-feedback]`，不要求页面逐个接入服务。`GlassCard` 在存在 `onClick` 时标记为交互卡片。反馈服务提供：

- 视觉：由共享 CSS 的 `:active` 和 Motion 的 `whileTap` 完成；
- 音效：首次真实点击后懒创建 `AudioContext`，播放不超过 24ms 的低音量短音；
- 触觉：支持时调用 `navigator.vibrate(8)`，桌面浏览器和不支持的 WebView 自动跳过；
- 失败边界：音频策略、权限、浏览器兼容性失败都不能阻断点击和导航；
- reduced-motion：关闭位移、回弹和触觉；音效降为静音，不创建额外动态。

不使用远程音频、在线图标或 Google Fonts，保证 APK 打包后的资源边界稳定。

### 3.5 滚动与滚动条

所有可滚动区域继续可以滚动，但隐藏原生滚动条轨道。`useScrollMotion` 只观察窗口是否离开顶部，给 `AppShell` 设置 `data-scroll-state="scrolled"`；壳层在滚动后增加很轻的背景不透明度和阴影，不隐藏 header、不修改页面内容、不模拟刷新。

## 4. 文件职责

- `apps/web/src/motion/tokens.ts`：Motion JS 侧时长、缓动和页面位移常量；
- `apps/web/src/components/RouteTransition.tsx`：只负责 route 进入/退出；
- `apps/web/src/hooks/useSwipeNavigation.ts`：只负责一级导航手势判定；
- `apps/web/src/hooks/useScrollMotion.ts`：只负责滚动状态观察；
- `apps/web/src/hooks/useInteractionFeedback.ts`：只负责 document click 监听的生命周期；
- `apps/web/src/services/interaction-feedback.ts`：只负责 Web Audio 和 vibrate 的安全调用；
- `apps/web/src/components/AppShell.tsx`：组合过渡之外的壳、手势和滚动状态，不承载音频实现；
- `apps/web/src/components/BottomNav.tsx`：继续维护五项导航数据和导航触摸反馈；
- `apps/web/src/styles/tokens.css`、`foundation.css`、`shell.css`、`components.css`：新增动效和可滚动区域语义样式。

不拆 `Icon.tsx`、`visual-types.ts` 或页面组件；本次只创建有独立验证边界的动效文件。

## 5. 验收与未确定项

- `pnpm check` 与 `pnpm --filter @hongtai/web build` 必须通过；
- 11 个 route 的浏览器审计不得出现 page error；
- 在 390×844 触摸模拟下，一级导航点击、页面过渡、左右滑动和纵向滚动都可复现；
- `prefers-reduced-motion: reduce` 下不得出现明显位移、回弹或旋转失控；
- 旧滚动条不可见，但滚动功能不能被禁用；
- 音效和振动只记录“浏览器支持时启用”，不把桌面浏览器无声/无振动视为失败；
- Android WebView 的具体版本、系统音量、振动权限和 APK 壳配置尚未确定，后续真机阶段再验证；
- 当前业务没有“刷新”契约，后续若需要下拉刷新必须由真实 adapter/API 定义完成和失败状态后再接入。

参考：

- https://motion.dev/docs/react-animate-presence
- https://motion.dev/docs/react
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
