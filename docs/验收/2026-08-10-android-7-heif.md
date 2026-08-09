# 2026-08-10 Android 7.x HEIF 实现证据

## 结论

Issue #6 的 Android 7.x 原生 HEIF fallback 已在独立 API 24、API 25 x86_64 AVD 上分别通过 6/6 instrumentation：真实 HEVC HEIF 解码、`irot`、尺寸与四角像素、损坏输入、8193 超限、外部引用、PNG 回归、JPEG 归一化与临时文件清理均由设备侧断言。上述端测使用 v5；v6 主机回归与签名后验历史保留在下方。当前候选已递增为 `versionCode=7`、`versionName=0.0.1`，v7 完成主机全量、release builder 与静态后验，但尚未做设备端复验。

这仍不是“Android 7.x 完整 UI 已通过”的声明。官方 SDK 镜像没有同时满足 API 24/25、x86_64 与 WebView ≥99 的可安全组合；API 24/25 原生 fallback 与 API 35 现代 WebView 的真实 UI/bridge/system picker 证据来自两组环境，不能拼接成同一设备的完整通过。物理 Android 7.x、ARM、OEM HEIC 和低内存压力也未验证。

## 审查回修后的 v6 主机证据

- 原生源码门禁：fetch 脚本新增纯离线 `-VerifyOnly`，逐依赖核对 marker 四字段、实时 source-tree SHA-256，并在读取普通文件前拒绝源码树或 marker 中的 reparse point。所有 Gradle native configure/build 任务依赖独立验证任务；绝对路径 `HONGTAI_HEIF_SOURCE_CACHE` 同步传给验证脚本与 CMake，相对路径被拒绝。TEMP 缓存副本脏改后，直接 `configureCMakeDebug[arm64-v8a]` 在验证任务失败且没有进入 CMake；恢复后同一任务通过，仓库内 canonical 缓存的源码与 marker hash 前后不变。
- WebView 边界：标准 Android provider 继续要求 Chromium 99；Huawei provider 没有可信的 product-major → Chromium 映射，因此 `minHuaweiWebViewVersion=2147483647` fail-closed，不声明受支持并进入本地静态中文页。错误页文案只泛指系统 WebView 或浏览器组件，不包含脚本、外链、网络或自动跳转。
- v6 release builder 唯一一次正式运行通过：release APK 为 25,890,603 字节，版本 `0.0.1 (6)`，证书 SHA-256 为 `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`，精确包含 12 个目标 `.so`，四 ABI 的 `LOAD` alignment 均为 `0x4000`，`zipalign -c -P 16 4` 通过，APK SHA-256 为 `666465ccfa291d3df70adafb9e139f03d5c144dd7f324c2cd14333f5b2e6a3ec`。
- 本节只记录 v6 主机证据；没有启动或改动 endpoint AVD，不把下方 v5 设备事实改写为 v6 通过。

## 第二轮复审后的 v7 实现状态

- Gradle 只让真实 `configureCMake*` 与 `buildCMake*` 依赖 `verifyHeifNativeSources`；`externalNativeBuildDebug/Release` 通过这些真实构建任务传递执行校验。`externalNativeBuildClean*` 和项目 `clean` 不再因不存在的源码缓存被 verifier 阻断，也不会创建该缓存；dirty configure/build 仍在进入 CMake 前失败。
- Huawei fail-closed 静态页改为诚实说明“网页运行组件版本过低，或当前提供程序尚未验证支持”；用户先更新系统 WebView 或浏览器组件，更新后仍显示时明确告知当前版本暂不支持该组件。页面仍无脚本、外链、网络或自动跳转。
- HTML 生产内容变化使候选递增为 v7。focused Node 为 22/22，`pnpm check` 为 214/214；Kotlin focused JVM、Debug Kotlin、androidTest 编译、Web build、Capacitor sync 与 clean/dirty gate 均通过。正式 release builder 唯一一次运行成功，release APK 为 25,890,671 字节，版本 `0.0.1 (7)`，证书 SHA-256 为 `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`，精确包含四 ABI × 三个目标 `.so`，所有 `LOAD` alignment 为 `0x4000`，`zipalign -c -P 16 4` 与 v2/v3 签名验证通过，APK SHA-256 为 `85c669347ed6c9d80fcf085d20a841b2c62a5dea2ee7462501633e5a996f4a0f`。APK 内配置仍为 Chromium 99、Huawei fail-closed 与本地错误页，错误页包含 v7 的诚实终态文案且保持无脚本、外链、网络和自动跳转。本轮没有运行 AVD，不把 v5 设备事实改写为 v7 通过。

## 已观察证据

- focused JVM：`ImageFormatProbeTest`、`ObservationImageDecoderSelectorTest`、`PrivateMediaImportPolicyTest` 通过；provider MIME/文件名不能覆盖字节权威。
- native/instrumentation：当前仓库的 debug 与 androidTest APK 在 API 24、API 25 `default` x86_64 AVD 分别安装成功，`PrivateMediaStoreInstrumentationTest` 均为 `OK (6 tests)`。两台设备均记录 `ro.kernel.qemu=1`、model `Android SDK built for x86_64`、ABI `x86_64`，SDK 分别为 24、25。baseline 输出 96×64、四角红/绿/蓝/黄；`irot` 输出 64×96、四角蓝/红/黄/绿；损坏、8193 超限和外部引用进入稳定异常，PNG 归一化为最长边不超过 2048 的 JPEG。两级结束时 `media/imports` 为空，未见 `.source`/`.part`；每台 AVD 验收后正常关机，最终 `adb devices` 无设备。
- fixture：`baseline.heic` SHA-256 `e5e6042f34cc86c46215f50636e55e9f9e41c0d49f59e931f7f24b1aa427dfe6`；无 EXIF、含真实 `irot` 的 90° CW fixture SHA-256 `77169628d144a56c603a41d4dd82d580a3b5ce2f061418ed0fd6efbeedbca266`。完整生成来源与负例 hash 见相邻 provenance 清单。
- 供应链：首次获取、二次 no-op 和损坏 archive 拒绝已观察；损坏输入未改变已验证缓存。源码 archive hash 与 lock 一致。
- ELF：四 ABI 的三个动态库全部 `LOAD` alignment `0x4000`；`DT_NEEDED` 证明 libheif → libde265、JNI → libheif + libde265。
- debug APK：精确包含 12 个目标 `.so`，`zipalign -c -P 16 4` 通过；本次静态检查 APK SHA-256 为 `06dac8412ce3db318b4427d457de891f101b4655cfb65480117255a5f4936778`。
- 初始 v4 release builder：不带降级参数的发布构建通过；release APK 为 25,893,547 字节，精确包含 12 个目标 `.so`，四 ABI `LOAD` alignment 均为 `0x4000`，`zipalign -c -P 16 4` 通过，APK SHA-256 为 `4811589735f73a995a41e0def91f150f64b3ae3654f9ba50ee7d452bf863b117`。
- WebView 能力边界：Capacitor 明确拒绝低于 Chromium 99 的 Android WebView，Vite production target 同步为 `chrome99`；`unsupported-webview.html` 是无脚本、无外链、无网络和无自动跳转的 UTF-8 中文静态页，public 与 Web build 副本 SHA-256 均为 `7a87390469cc07c97974db6ac770b6acea2be267c978db5104b94a6688f081a5`。API 24 Google APIs AVD 的 Chrome/WebView 69 上，v4 首先真实复现空白页；随后不卸载、不带 `-d` 的 `adb install --no-streaming -r` 将同证书 v4 正常升级到 v5，`firstInstallTime` 保持 `2026-08-09 16:27:52`，`lastUpdateTime` 更新为 `16:37:49`。v5 冷启动显示四段中文更新提示，未见 crash/ANR。该次 SwiftShader 截图存在黑色合成矩形，只使用完整 UI tree 作为功能证据，不声明视觉通过。
- API 25 Google APIs AVD 的 Chrome/WebView 69 上，v5 冷启动显示完整、可读的中文更新提示页；host GPU 截图无上述黑块，未见 crash/ANR。这证明不受支持的 provider 有明确终态，不证明完整应用 UI 可运行。
- 当前 v5 release builder：唯一一次正式构建与签名后验通过；release APK 为 25,890,599 字节，版本 `0.0.1 (5)`，证书 SHA-256 为 `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`，精确包含 12 个目标 `.so`，四 ABI `LOAD` alignment 均为 `0x4000`，`zipalign -c -P 16 4` 通过，APK SHA-256 为 `528628836398b7cb13154bb7ac1a74f13703326114ee77b7e486508da9a2e312`。APK 内 `capacitor.config.json` SHA-256 为 `2912f0921762fea2dd5d388f287be7bd7f959cada0e75307b0ec5bb07e741379`，明确记录 `minWebViewVersion=99` 与 `errorPath=unsupported-webview.html`。

## UI、桥接与系统选择器组合证据

- API 35 `SciChatApi35` read-only AVD 记录 `ro.kernel.qemu=1`、model `sdk_gphone64_x86_64`、ABI `x86_64`，使用 WebView `124.0.6367.219`；同一 v5 release 冷启动为 `COLD`，首页、AI 导航与“舌象与面部观察”页面可访问。
- 生产代码在 API 33+ 使用系统 Photo Picker，而不是 DocumentsUI。将三份已校验 fixture 登记为 `image/heic`、`image/heic`、`image/png` 后，真实 Photo Picker 选择 baseline HEIC 成功，页面出现预览且“生成观察报告”解除禁用。
- 再次选择 12 字节损坏 HEIC 后，页面稳定显示“无法读取或规范化图片”、`IMAGE_INVALID · ERR_IMAGE_INVALID` 与“重新选择”；忙碌已解除，可立即重试。随后通过同一系统 Photo Picker 选择 PNG 成功，旧错误与错误码消失，预览、选择按钮和生成按钮均可用。
- API 35 release 包不可 `run-as`，因此没有伪造私有目录检查；`.source`/`.part` 和输出 JPEG 约束由上述 API 24/25 instrumentation 断言。完整矩阵的 sanitized logcat 未出现 app crash、ANR、OOM 或 `UnsatisfiedLinkError`。
- 系统 Download 的 HEIC 在旧 DocumentsUI 中不会稳定显示，因此证据 TEMP 内构建了最小 test-only `DocumentsProvider`。它不进入生产仓库、不申请宽权限，只提供固定 baseline、malformed 与 PNG；API 24 DocumentsUI 已真实列出三份文件。API 35 生产路径使用 Photo Picker，所以该 provider 没有被冒充为 API 35 的生产选择源。

## 为什么仍缺少 Android 7.x 完整 UI 组合

- `default` API 24/25 镜像内置 WebView 52；`google_apis` API 24/25 为 69；`google_apis_playstore` API 24 为 Chrome 51/WebView 53，API 25 为 55。未登录有限等待后 Play Store 明确报告没有账户，版本不变。
- 官方 AOSP Android 13 r1 x86 WebView prebuilt 为 `101.0.4951.61`、minSdk 23，但其签名与 fresh API 24 AVD 内置 `com.android.webview` 不同，不能普通 `adb install -r`。验收没有使用 root、remount、降级参数、第三方 APK 或签名绕过。
- 因此当前合法本地组合无法在 API 24/25 上同时运行完整 Web UI 和 native fallback。必须在具备 WebView ≥99 的物理 Android 7.x 或等价、受控且同签名的模拟环境补验，才能关闭这一组合缺口。

## 待后续端测

- 在 WebView ≥99 的物理 API 24、API 25 设备分别通过真实系统 DocumentsUI 完成 baseline HEIC、损坏 HEIC、PNG 重试的同设备 UI + fallback 闭环；
- 补充 ARM ABI runtime、OEM HEIC 相机产物、低内存和大图压力；
- 补充 API 26–32 平台 HEIF 路径以及 WebP 回归。

现有 x86_64 AVD 证据不能代替上述物理设备验收，也不能被描述为正式 release 或全部 Android 7.x 设备兼容。
