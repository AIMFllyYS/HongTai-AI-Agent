# 2026-08-10 Android 7.x HEIF 实现证据

## 结论

Issue #6 的 Android 7.x 原生 HEIF fallback 已在独立 API 24、API 25 x86_64 AVD 上用当前 HEAD `93c7e9dc2dadf604bf1105d86be08c70968e14df` 分别通过 6/6 instrumentation：真实 HEVC HEIF 解码、`irot`、尺寸与四角像素、损坏输入、8193 超限、外部引用、PNG 回归、JPEG 归一化与临时文件清理均由设备侧断言。同两台 AVD 还完成同证书 v5→v7 普通升级、v7 冷启动与不支持 WebView 的中文终态页复验；API 35 则完成 v7 首页、观察页、真实系统 Photo Picker 的平台可解码 HEIC 与 PNG 正向回归。当前候选为 `versionCode=7`、`versionName=0.0.1`。

这仍不是“Android 7.x 完整 UI 已通过”的声明。官方 SDK 镜像没有同时满足 API 24/25、x86_64 与 WebView ≥99 的可安全组合；API 24/25 原生 fallback 与 API 35 现代 WebView 的真实 UI/bridge/system picker 证据来自两组环境，不能拼接成同一设备的完整通过。物理 Android 7.x、ARM、OEM HEIC 和低内存压力也未验证。

## 审查回修后的 v6 主机证据

- 原生源码门禁：fetch 脚本新增纯离线 `-VerifyOnly`，逐依赖核对 marker 四字段、实时 source-tree SHA-256，并在读取普通文件前拒绝源码树或 marker 中的 reparse point。所有 Gradle native configure/build 任务依赖独立验证任务；绝对路径 `HONGTAI_HEIF_SOURCE_CACHE` 同步传给验证脚本与 CMake，相对路径被拒绝。TEMP 缓存副本脏改后，直接 `configureCMakeDebug[arm64-v8a]` 在验证任务失败且没有进入 CMake；恢复后同一任务通过，仓库内 canonical 缓存的源码与 marker hash 前后不变。
- WebView 边界：标准 Android provider 继续要求 Chromium 99；Huawei provider 没有可信的 product-major → Chromium 映射，因此 `minHuaweiWebViewVersion=2147483647` fail-closed，不声明受支持并进入本地静态中文页。错误页文案只泛指系统 WebView 或浏览器组件，不包含脚本、外链、网络或自动跳转。
- v6 release builder 唯一一次正式运行通过：release APK 为 25,890,603 字节，版本 `0.0.1 (6)`，证书 SHA-256 为 `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`，精确包含 12 个目标 `.so`，四 ABI 的 `LOAD` alignment 均为 `0x4000`，`zipalign -c -P 16 4` 通过，APK SHA-256 为 `666465ccfa291d3df70adafb9e139f03d5c144dd7f324c2cd14333f5b2e6a3ec`。
- 本节只记录 v6 主机证据；没有启动或改动 endpoint AVD，不把下方 v5 设备事实改写为 v6 通过。

## 第二轮复审后的 v7 实现状态

- Gradle 只让真实 `configureCMake*` 与 `buildCMake*` 依赖 `verifyHeifNativeSources`；`externalNativeBuildDebug/Release` 通过这些真实构建任务传递执行校验。`externalNativeBuildClean*` 和项目 `clean` 不再因不存在的源码缓存被 verifier 阻断，也不会创建该缓存；dirty configure/build 仍在进入 CMake 前失败。
- Huawei fail-closed 静态页改为诚实说明“网页运行组件版本过低，或当前提供程序尚未验证支持”；用户先更新系统 WebView 或浏览器组件，更新后仍显示时明确告知当前版本暂不支持该组件。页面仍无脚本、外链、网络或自动跳转。
- HTML 生产内容变化使候选递增为 v7。focused Node 为 22/22，`pnpm check` 为 214/214；Kotlin focused JVM、Debug Kotlin、androidTest 编译、Web build、Capacitor sync 与 clean/dirty gate 均通过。正式 release builder 唯一一次运行成功，release APK 为 25,890,671 字节，版本 `0.0.1 (7)`，证书 SHA-256 为 `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`，精确包含四 ABI × 三个目标 `.so`，所有 `LOAD` alignment 为 `0x4000`，`zipalign -c -P 16 4` 与 v2/v3 签名验证通过，APK SHA-256 为 `85c669347ed6c9d80fcf085d20a841b2c62a5dea2ee7462501633e5a996f4a0f`。APK 内配置仍为 Chromium 99、Huawei fail-closed 与本地错误页，错误页包含 v7 的诚实终态文案且保持无脚本、外链、网络和自动跳转。下方新增当前 HEAD 与该正式候选的 AVD 增量端测，旧 v5 事实仅作为升级基线保留。

## 已观察证据

- focused JVM：`ImageFormatProbeTest`、`ObservationImageDecoderSelectorTest`、`PrivateMediaImportPolicyTest` 通过；provider MIME/文件名不能覆盖字节权威。
- native/instrumentation：当前 HEAD 新构建的 debug APK（SHA-256 `622db056f5762c9017a9012b19d9d3fe0e90ea28c20c99b6e903da23482e59a7`）与 androidTest APK（SHA-256 `3e48281d73513737c4bd7b05deb8af976a74577072c2644b03918f71cfc64679`）在 API 24、API 25 x86_64 专用 AVD 分别安装成功，`PrivateMediaStoreInstrumentationTest` 均为 `OK (6 tests)`。两台设备均记录 `ro.kernel.qemu=1`、ABI `x86_64`，SDK 分别为 24、25，WebView 分别为 53 与 55。baseline 输出 96×64、四角红/绿/蓝/黄；`irot` 输出 64×96、四角蓝/红/黄/绿；损坏、8193 超限和外部引用进入稳定异常，PNG 归一化为最长边不超过 2048 的 JPEG。两级结束时 `media/imports` 为空，未见 `.source`/`.part`；应用侧未见 crash、ANR、OOM 或链接错误。每台 AVD 验收后正常关机，最终 `adb devices` 无设备。
- fixture：`baseline.heic` SHA-256 `e5e6042f34cc86c46215f50636e55e9f9e41c0d49f59e931f7f24b1aa427dfe6`；无 EXIF、含真实 `irot` 的 90° CW fixture SHA-256 `77169628d144a56c603a41d4dd82d580a3b5ce2f061418ed0fd6efbeedbca266`。完整生成来源与负例 hash 见相邻 provenance 清单。
- 供应链：首次获取、二次 no-op 和损坏 archive 拒绝已观察；损坏输入未改变已验证缓存。源码 archive hash 与 lock 一致。
- ELF：四 ABI 的三个动态库全部 `LOAD` alignment `0x4000`；`DT_NEEDED` 证明 libheif → libde265、JNI → libheif + libde265。
- debug APK：精确包含 12 个目标 `.so`，`zipalign -c -P 16 4` 通过；本次静态检查 APK SHA-256 为 `06dac8412ce3db318b4427d457de891f101b4655cfb65480117255a5f4936778`。
- 初始 v4 release builder：不带降级参数的发布构建通过；release APK 为 25,893,547 字节，精确包含 12 个目标 `.so`，四 ABI `LOAD` alignment 均为 `0x4000`，`zipalign -c -P 16 4` 通过，APK SHA-256 为 `4811589735f73a995a41e0def91f150f64b3ae3654f9ba50ee7d452bf863b117`。
- WebView 能力边界：Capacitor 明确拒绝低于 Chromium 99 的 Android WebView，Vite production target 同步为 `chrome99`；`unsupported-webview.html` 是无脚本、无外链、无网络和无自动跳转的 UTF-8 中文静态页，public 与 Web build 副本 SHA-256 均为 `7a87390469cc07c97974db6ac770b6acea2be267c978db5104b94a6688f081a5`。API 24 Google APIs AVD 的 Chrome/WebView 69 上，v4 首先真实复现空白页；随后不卸载、不带 `-d` 的 `adb install --no-streaming -r` 将同证书 v4 正常升级到 v5，`firstInstallTime` 保持 `2026-08-09 16:27:52`，`lastUpdateTime` 更新为 `16:37:49`。v5 冷启动显示四段中文更新提示，未见 crash/ANR。该次 SwiftShader 截图存在黑色合成矩形，只使用完整 UI tree 作为功能证据，不声明视觉通过。
- API 25 Google APIs AVD 的 Chrome/WebView 69 上，v5 冷启动显示完整、可读的中文更新提示页；host GPU 截图无上述黑块，未见 crash/ANR。这证明不受支持的 provider 有明确终态，不证明完整应用 UI 可运行。
- 当前 v7 增量升级：API 24 AVD 先安装已验 v5，再以普通 `adb install --no-streaming -r` 安装 v7，未卸载、不带 `-d`；版本从 5 变为 7，`firstInstallTime` 保持 `2026-08-09 18:27:25`，`lastUpdateTime` 更新为 `18:27:37`。API 25 同样从 5 升到 7，`firstInstallTime` 保持 `2026-08-09 18:30:34`，`lastUpdateTime` 更新为 `18:30:47`。两台均为同一 release 证书，v7 冷启动的 UI tree 原文为“当前设备的网页运行组件版本过低，或当前提供程序尚未验证支持，无法安全打开宏泰 AI 智能体。”以及“请先在系统设置或应用商店更新系统 WebView 或浏览器组件；若更新后仍显示此页，当前版本暂不支持该网页运行组件。”，并明确“应用不会在此页面联网或自动跳转。”截图受 SwiftShader 黑色合成矩形影响，只把 UI tree 作为文字与终态功能证据，不声明视觉通过。
- 当前 v5 release builder：唯一一次正式构建与签名后验通过；release APK 为 25,890,599 字节，版本 `0.0.1 (5)`，证书 SHA-256 为 `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`，精确包含 12 个目标 `.so`，四 ABI `LOAD` alignment 均为 `0x4000`，`zipalign -c -P 16 4` 通过，APK SHA-256 为 `528628836398b7cb13154bb7ac1a74f13703326114ee77b7e486508da9a2e312`。APK 内 `capacitor.config.json` SHA-256 为 `2912f0921762fea2dd5d388f287be7bd7f959cada0e75307b0ec5bb07e741379`，明确记录 `minWebViewVersion=99` 与 `errorPath=unsupported-webview.html`。

## UI、桥接与系统选择器组合证据

- API 35 `SciChatApi35` read-only AVD 记录 `ro.kernel.qemu=1`、model `sdk_gphone64_x86_64`、ABI `x86_64`，使用 WebView `124.0.6367.219`。设备原有的是 versionCode 1、Debug 证书包，和 release v7 签名不同，普通覆盖安装按预期被系统拒绝；只卸载该旧 Debug 包后首次安装已锁定的 v7 release，冷启动为 `COLD`，首页、AI 导航与“舌象与面部观察”页面可访问。这不是 v5→v7 升级证据，升级结论只来自上述 API 24/25 同证书链。
- 生产代码在 API 33+ 使用系统 Photo Picker，而不是 test-only `DocumentsProvider`。最初的 557 字节 `baseline.heic` 是为原生 fallback 构造的最小 fixture；API 35 平台 `HeifDecoderImpl` 对它报告没有有效图像，普通 Photo Picker 没有向应用返回可用 URI。因此旧 v5 记录中把它写成 API 35 成功样本的结论已撤回。改用锁定的 libheif `example.heic`（718,114 字节，SHA-256 `7f8b363e4936c0666a25f64f3a92fda10bd8e5453be4592530b65a55dd98f3f2`）登记到 MediaStore 后，真实 Photo Picker 返回该平台可解码 HEIC；页面显示城市图片预览，“生成观察报告”启用，未见导入忙碌残留。
- 12 字节损坏 HEIC 虽可登记到 MediaStore，但 API 35 普通 Photo Picker/MediaProvider 在预览与同步阶段将其过滤，未把 URI 交给应用。缓存可选条目后替换底层文件、保留缩略图但损坏主图等尝试也会被 MediaProvider 移除或过滤；验收随即停止继续换 HEIF 样本。另用真实 Picker 可见的 GIF 检查通用失败态时，底层文件也只由 Photo Picker UID 10202 打开，应用 UID 10213 未读取，页面保留既有预览。故本轮**不声称** API 35 UI 已显示 `IMAGE_INVALID` 或其 busy 终态，也不把 GIF 当成 HEIF 失败证据；损坏 HEIF 的稳定失败与临时文件清理由 API 24/25 instrumentation 决定性覆盖。
- 随后将已校验 PNG 重新登记为最近媒体，经同一真实 Photo Picker 选择后页面立即显示红/绿/蓝/黄四象限预览，“生成观察报告”保持启用，UI tree 不含 `IMAGE_INVALID`、导入忙碌或空选择态。由于前一步没有形成应用错误态，本轮只证明 PNG 即时重试成功，不声称“旧错误已清除”。
- API 35 release 包不可 `run-as`，因此没有伪造私有目录检查；`.source`/`.part` 和输出 JPEG 约束由上述 API 24/25 instrumentation 断言。API 35 picker 边界日志和 PNG 重试日志未见 app crash、ANR、OOM 或 `UnsatisfiedLinkError`。三台 AVD 均已关机，最终 `adb devices` 为空。
- 本轮锁定 APK、fixture、UI tree、截图和安全日志位于仓库外 `C:\Users\AIMFl\AppData\Local\Temp\HongTai-Issue6-v7-E2E-20260810-072157-ff5a1195`。这是可复核的模拟器证据目录，不是生产资源或仓库 fixture。

## 为什么仍缺少 Android 7.x 完整 UI 组合

- `default` API 24/25 镜像内置 WebView 52；`google_apis` API 24/25 为 69；`google_apis_playstore` API 24 为 Chrome 51/WebView 53，API 25 为 55。未登录有限等待后 Play Store 明确报告没有账户，版本不变。
- 官方 AOSP Android 13 r1 x86 WebView prebuilt 为 `101.0.4951.61`、minSdk 23，但其签名与 fresh API 24 AVD 内置 `com.android.webview` 不同，不能普通 `adb install -r`。验收没有使用 root、remount、降级参数、第三方 APK 或签名绕过。
- 因此当前合法本地组合无法在 API 24/25 上同时运行完整 Web UI 和 native fallback。必须在具备 WebView ≥99 的物理 Android 7.x 或等价、受控且同签名的模拟环境补验，才能关闭这一组合缺口。本轮 API 24/25 instrumentation、低版本静态页与 API 35 现代 UI/Photo Picker 是分层证据，不能拼成 Android 7.x 同设备完整通过。

## 待后续端测

- 在 WebView ≥99 的物理 API 24、API 25 设备分别通过真实系统 DocumentsUI 完成 baseline HEIC、损坏 HEIC、PNG 重试的同设备 UI + fallback 闭环；
- 补充 ARM ABI runtime、OEM HEIC 相机产物、低内存和大图压力；
- 补充 API 26–32 平台 HEIF 路径以及 WebP 回归。

现有 x86_64 AVD 证据不能代替上述物理设备验收，也不能被描述为正式 release 或全部 Android 7.x 设备兼容。
