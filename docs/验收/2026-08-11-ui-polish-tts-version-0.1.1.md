# 2026-08-11 应用界面优化、系统 TTS 与 v0.1.1

## 任务契约

## 目标

- 让观察图片选择框中的相机图标与“尚未选择图片”逐项水平居中，且“生成观察报告”按钮的前景为纯黑并保持可读。
- 让已保存视频在元数据加载后按实际横竖比显示，而不是把竖版视频固定放进 16:9 横框。
- 明确“素材剪辑 + TTS”使用 Android 系统中文 TTS 配音，并从制作页进入设置页的真实系统 TTS 配置入口。
- 在设置中新增“应用信息”，展示本机构建的 `0.1.1` 版本与本次更新摘要；Android `versionCode` 递增至 `8`。

## 允许修改

- `apps/web` 的观察、媒体展示、制作、设置页面、路由和相邻样式。
- `packages/core` 与 `packages/capacitor-runtime` 的版本化设备设置 DTO 和 AppRuntime 适配。
- `android/app` 的受控系统设置 Intent、构建版本和相关测试。
- 受影响的测试、发布操作指南与当前能力状态。

## 明确不做

- 不新增云端 TTS、登录、同步、素材库、发布能力、宽泛媒体权限或伪造的配置状态。
- 不把页面预览、模拟器或 Debug APK 表述为物理真机或正式 release 验收。
- 不改变 AI Flow、制作计划规则、用户媒体内容或已有成功成片。

## 架构归属

- 所属层：UI、core、capacitor-runtime、Android I/O。
- 页面只经 `AppRuntime` 读取应用信息或打开系统 TTS 设置；Android 仅返回构建信息并启动系统设置 Activity，不决定页面文案、AI 逻辑或制作计划。

## 权威状态与数据

- 视频展示比例来自安全展示 URI 的 HTML 媒体元数据，`MediaReference.width/height` 仅在已有时作为首帧提示；不会写回或修改任务媒体。
- 应用版本以 Android 已安装包的 `PackageManager` 信息为单一权威；最近更新摘要随 APK 打包，不进行联网版本检查。
- TTS 引擎、中文语音和语速仍由 Android 系统设置权威决定；页面不伪造“已安装”状态。

## 验收

- 定向测试：观察布局和按钮对比度、视频自然比例、TTS/应用信息路由与 Android bridge、v0.1.1 版本门禁。
- 构建 / lint：`pnpm check`、Web production build、Android Debug JVM 测试、`lintDebug`、Debug APK 构建。
- 浏览器或真机证据：桌面与约 390px 页面截图；如无物理设备，仅记录模拟器或浏览器证据。
- 用户实际会看到什么：图标与文字准确对齐、报告按钮黑字清晰、竖版视频展示为竖版、可从设置打开系统 TTS、应用信息显示 0.1.1 与更新内容。

## 实施与验收结果

### 已实现

- 图片观察占位框以同一个居中网格承载相机图标和“尚未选择图片”；报告主按钮及其禁用态均使用纯黑前景色。
- 已保存视频不再固定为 16:9：优先使用 `MediaReference.width/height`，缺失时由 HTML `loadedmetadata` 的真实 `videoWidth/videoHeight` 决定横版、竖版或方形比例；竖版框在可用宽度内居中且保持竖版。
- “素材剪辑 + TTS”明确使用 Android 系统中文 TTS 与字幕；设置页提供真实的系统语音包入口，数字人口播继续保留原视频声音、只生成字幕。
- 设置新增 TTS 与应用信息入口。应用信息通过 Android 包信息显示已安装 APK 的 `0.1.1` 与构建号 `8`，并列出本次更新。
- Android WebView 的状态栏安全区使用 Android 基线与设备 `env()` 中较大者，避免状态图标压住固定标题，同时不再引入单独的页面顶部白条。

### 验证证据

- `pnpm check`：226/226 通过。
- `pnpm --filter @hongtai/web build` 与 `pnpm exec cap sync android` 通过；同步后的 `config.xml` 已用仓库脚本规范为 UTF-8 无 BOM、无空白行。
- `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest --rerun-tasks` 通过；最终再执行 `:app:assembleDebug --rerun-tasks`。
- API 35 x86_64 模拟器上以普通 `adb install --no-streaming -r` 安装最终 Debug APK，`versionCode=8`、`versionName=0.1.1`，保留既有 `firstInstallTime`；冷启动无 AndroidRuntime/libc/DEBUG 崩溃日志。
- 模拟器截图核验了顶部状态栏与标题不重叠、图片占位框居中、黑字报告按钮、设置入口、TTS 页面、Android 系统 Google TTS voice data 页面，以及应用信息页的 `0.1.1 / 8`。浏览器也在 1440px 与 390px 视口完成设置页与制作页可读性检查。
- 最终 Debug APK：`android/app/build/outputs/apk/debug/app-debug.apk`，SHA-256 `15093BD71637D7A88A17C75153121F562407C28F3AA54FB27F102D8BF18A2729`。

### 交付边界

- 本轮未伪造或导入一条用户视频来制造“已保存媒体”截图；竖版比例由真实浏览器媒体元数据驱动并由定向测试锁定，仍应在后续带真实已保存竖版视频的物理设备验收中补做可见闭环。
- 本 APK 是 Debug 签名的模拟器验证，不是物理真机、同 release 证书升级或正式发布验收。
- OEM 的系统 TTS Activity、中文语音包与 Media3 渲染仍需要物理 Android 设备复验。
