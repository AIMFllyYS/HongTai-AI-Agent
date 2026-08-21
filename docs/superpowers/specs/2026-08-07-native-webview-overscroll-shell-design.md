# Android 原生边缘效果与固定导航壳层设计

> 状态：**部分过期**。固定顶栏、底栏和「WebView 作为纵向滚动主体」仍有效。`OVER_SCROLL_ALWAYS` 与「拉伸或边缘光效可接受」已否决：当前源码使用 `OVER_SCROLL_NEVER`，`html`/`body` 使用 `overscroll-behavior: none`。横向滑动视口只许 `overscroll-behavior-x: contain`，禁止对 Y 轴设 `none`。不做下拉刷新。活口径见 [动效规范](../../动效规范.md) 第 5 节。
>
> 日期：2026-08-07

## 目标

让 APK 的纵向滚动反馈遵循 Android 系统 WebView 的原生边缘效果，同时统一缩小并永久固定顶部栏和底部栏。改动只涉及应用界面层和 Android WebView 展示配置，不修改任务、AI、媒体、存储或路由业务逻辑。

## 已选择方案

采用 Android 原生 WebView 边缘效果，而不是在 React 中实现一套手势物理模型。

- Kotlin 在现有 `MainActivity` 初始化完成后，将 Capacitor WebView 的 `overScrollMode` 设为 `View.OVER_SCROLL_ALWAYS`。
- 不新增 Capacitor 插件，不新增 React 与 Kotlin 之间的滚动协议，不自定义第二套状态机。
- 边缘反馈的具体视觉由设备上的 Android System WebView 决定。不同 Android/WebView 版本可能表现为拉伸或边缘光效，不强制模拟完全一致的位移动画。
- Android 官方约束是：只有 WebView 本身具备滚动能力时，`OVER_SCROLL_ALWAYS` 才会产生作用。因此短到无法滚动的页面不制造假滚动距离。

## 应用壳层

保留 WebView 作为纵向滚动主体，使 Android 原生边缘效果能够工作；顶部栏和底部栏在 Web 页面中使用固定定位形成独立视觉层。

### 顶部栏

- 使用 `position: fixed`，永久固定在视口顶部。
- 高度由当前 `4.25rem` 收紧为 `3.5rem`，并继续计入 `safe-area-inset-top`。
- 图标视觉尺寸约 `1.25rem`，可点击区域不低于 `2.75rem`。
- 品牌页和详情页继续共用 `AppShell`，不增加逐页特例。

### 底部栏

- 保持 `position: fixed` 和五等分布局。
- 高度由当前 `5rem` 收紧为 `4rem`，并继续计入 `safe-area-inset-bottom`。
- 图标视觉尺寸约 `1.25rem`，标签使用现有最小正文层级；每个入口点击区域不低于 `2.75rem`。
- 激活态、颜色和五个既有入口保持不变。

### 主内容

- 页面仍由 WebView 根滚动，不引入嵌套纵向滚动容器。
- `app-content` 增加与固定顶部栏、底部栏匹配的上下安全间距，内容不得被导航遮挡。
- 路由横向滑动继续由 `SwipeRouteViewport` 处理，不修改已有提交与回弹逻辑。
- 顶部通知继续位于固定顶部栏之上，不改变五秒倒计时和上滑关闭交互。

## 动效与无障碍

- 原生边缘效果由 Android 系统处理，不在 JavaScript 中重复监听 `touchmove`。
- `prefers-reduced-motion` 继续控制 Web 页面动画；系统边缘效果服从设备级动画设置。
- 固定导航的视觉尺寸可以缩小，但触摸热区不得低于 44px。
- 不增加横向溢出，不让固定栏参与页面滚动或路由切换位移。

## 测试与验收

先增加失败测试，再修改生产代码：

1. Web 壳层契约测试：顶部栏固定、导航变量为 `3.5rem/4rem`、内容安全间距存在、触摸热区不低于 44px。
2. Android 源码契约或单元测试：WebView 初始化后使用 `OVER_SCROLL_ALWAYS`，且不新增插件接口。
3. 运行现有 Web、Capacitor Runtime 和 Android 测试。
4. 构建 debug APK，并在 API 35 模拟器验证：
   - 顶部栏和底部栏在长页面滚动时位置不变；
   - 顶部和底部边缘出现系统 WebView 提供的原生反馈；
   - 页面首尾内容不被固定栏遮挡；
   - 五个底部入口、详情返回按钮和横向切页仍可使用。

## 明确不做

- 不编写 JavaScript 弹簧、阻尼或拖拽状态机。
- 不自定义 `EdgeEffect` 绘制，不通过反射替换 WebView 内部实现。
- 不将顶部栏或底部栏迁移成 Android XML 原生 View。
- 不修改任何本地应用逻辑层、Kotlin 文件能力或 AI 配置。
