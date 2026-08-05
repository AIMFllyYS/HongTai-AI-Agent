# 移动端关键交互 BUG 修复分析

## 范围

本次只处理前端壳层的三个移动端交互问题：底部导航常驻、水平左右拖拽、底部导航直接跳转。不会修改 CLI、API、DTO、数据库、鉴权、任务状态机或业务页面的数据边界。

## 第一性原理与证据链

### 1. 底部导航必须属于 viewport chrome

底部导航的职责是跨页面持续提供一级入口，因此它的定位参照物必须是 viewport，而不能依赖某个页面内容容器或路由动画容器。

当前 `RouteTransition` 用 `motion.div` 包住 `AppShell`，并在页面切换时对该祖先设置 `transform`。CSS 中的 fixed 后代在存在 transformed ancestor 时可能改以该祖先作为包含块，导致导航在切换、滚动或不同浏览器实现下表现为跟随页面内容、短暂消失或位置重算。

最小修复是把 `BottomNav` portal 到 `document.body`，使它脱离路由动画的 transform 树；`AppShell` 继续保留底部安全区和内容 padding，保证最后一项内容不会被导航遮挡。主题属性同时传给 portal 节点，避免脱离壳后丢失 warm-soft-tech 语义 token。

### 2. 水平手势必须使用真实位移和稳定方向不变量

手势的原始事实是 `deltaX = currentX - startX`：

- `deltaX < 0` 表示指针向左移动，切换到主导航顺序中的下一项；
- `deltaX > 0` 表示指针向右移动，切换到主导航顺序中的上一项；
- 只有水平位移超过阈值且显著大于垂直位移时才提交导航；
- 交互控件、输入控件和显式禁止手势区域不参与页面切换。

当前实现只接受 touch/pen，鼠标拖拽永远不会进入提交路径；同时没有 `pointermove`、`setPointerCapture` 或拖拽偏移，因此用户看不到页面跟随指针的真实水平反馈。修复会统一支持 mouse、touch、pen，在识别为水平手势后让当前内容跟随位移，并在释放时复用同一个 `deltaX` 方向不变量。垂直滚动仍由浏览器处理，不改变 `touch-action: pan-y`。

### 3. 一级底部导航是直接定位，不应等待页面过渡

底部导航点击的核心反馈是“立即进入所选一级页面”。当前点击沿用路由的 `AnimatePresence mode="wait"` 和非 reduced-motion 下的 smooth scroll，用户需要等待退出动画和滚动完成，造成点击不直接、像是响应迟缓。

路由仍需要保留页面内进入详情、返回和手势切换的统一过渡；因此不移除全局动效，而是给导航器增加可选的 `transition` 与 `scroll` 选项。底部导航明确传入 `transition: "instant"`、`scroll: "auto"`，只绕过一级导航入口的动画和 smooth scroll。

## 修复不变量

1. `BottomNav` 的 DOM 不在 `RouteTransition` 的 transformed subtree 中，且仍由 `AppShell` 控制是否显示。
2. 内容区域具有可观察的水平拖拽偏移；提交方向只由 `deltaX` 决定，左右不反转，越界项不导航。
3. 底部导航点击只改变浏览器路径和页面内容，不等待页面退出动画，也不平滑滚动到顶部。
4. 页面内原有路由过渡、返回路径、五项导航顺序、主题 token 和数据适配器保持不变。
5. reduced-motion 继续生效，交互控件不会被页面级手势误触发。

## 验收证据

- 静态测试锁定 portal、direct navigation、mouse pointer、pointer capture、live offset 和左右方向映射。
- `pnpm check`、`pnpm --filter @hongtai/web build` 通过。
- 浏览器回归覆盖：滚动前后导航位置、底部导航立即跳转、鼠标右拖/左拖、触控左右拖、垂直滚动不切页、无 page error。
- 截图只用于核验壳层位置和拖拽后的视觉，不宣称与设计稿像素级一致。
