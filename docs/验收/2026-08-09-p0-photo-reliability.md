# P0 照片可靠性验收记录（Issue #1、#2）

日期：2026-08-09
范围：仅 GitHub Issue #1 与 #2；未处理 #3、#4 及后续 Issue。

## 根因与修复边界

原实现把待拍摄文件和 Capacitor `PluginCall` 仅保存在内存中。外部相册或相机导致 Activity、进程、WebView 重建后，旧 Promise 已不可恢复，回调中的空调用、缺失 URI 和丢失拍摄文件又存在静默结束路径。与此同时，Activity-result 回调同步执行复制、解码、旋转、缩放、JPEG 压缩和落盘，可能阻塞 Android 主线程。React 页面只有报告生成的 `loading`，无法独立表达图片导入过程，也不能保证所有图片操作终态解除忙碌状态。

本次修复限定在系统 I/O、恢复状态、版本化 AppRuntime DTO 和 Observation 页面状态：

1. `PhotoOperationStateStore` 持久化单一、短生命周期的照片操作状态，只保存恢复所需控制元数据；状态为等待外部结果、后台导入、成功或失败，终态只能写入一次，消费后清理。
2. 外部 Activity 返回时仅做结果分类和轻量编排。有效来源交给单线程照片导入 executor；复制、图片解码、EXIF 旋转、缩放、JPEG 压缩和原子落盘均在后台执行。
3. 活跃的原始 `PluginCall` 可正常完成；Capacitor 标记为 dangling 的旧调用不会被当作仍可完成的 Promise。重建后的 WebView 通过新的 `consumePhotoOperation` 调用消费持久化终态。
4. 若 Activity 已恢复但结果回调丢失，等待态会转为明确的恢复失败终态，不会永久停留在导入中。
5. `PrivateMediaStore` 原有有界复制、归一化、临时文件与原子替换规则继续作为唯一实现；新增读取失败分类和 API 24 可用的有界文件头读取。
6. Capacitor Runtime 只向 React 返回安全 `MediaReference` 或稳定 `TaskIssue`；页面不直接调用原生插件，也不读取原生私有存储位置。
7. Observation 页面新增独立 `importing` 状态。初始恢复、选择、拍摄、成功、取消、超限、无效图片、读取失败、导入失败和恢复失败都会进入明确终态并解除忙碌状态。

## 稳定终态映射

| 原生结果 | AppRuntime 结果 |
| --- | --- |
| 用户取消 | `MEDIA_SELECTION_CANCELLED` |
| 缺失来源 URI | `MEDIA_SOURCE_NOT_FOUND` |
| 拍摄文件丢失、恢复失败 | `TASK_INTERRUPTED` |
| 媒体无法读取 | `MEDIA_READ_FAILED` |
| 私有化导入失败 | `MEDIA_IMPORT_FAILED` |
| 图片超限 | `IMAGE_TOO_LARGE` |
| 图片无效 | `IMAGE_INVALID` |
| 导入成功 | 安全 `MediaReference` |

## 已验证

- `pnpm check`：通过；TypeScript、ESLint 与根测试共 181 项通过。
- `pnpm --filter @hongtai/capacitor-runtime test`：27 项通过，覆盖恢复成功和全部原生错误映射。
- `pnpm --filter @hongtai/web build`：通过；610 个模块完成生产构建，仅保留既有的大 chunk 提示。
- `:app:testDebugUnitTest`：48 项 JVM 测试通过，0 失败、0 跳过。
- `:app:compileDebugAndroidTestKotlin`：通过；真实图片私有化、JPEG 输出、尺寸上限和临时文件清理的 instrumentation 测试已成功编译。
- `:app:assembleDebug`：通过。调试 APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`，SHA-256 为 `1463CC77FAB8957FFD01FF68BDCF0AD38283F2BAFC60BE76074B6DF99162BD6E`。
- 浏览器视觉检查：1280×900 与 390×844 下 Observation 页面无新增溢出、遮挡或中文乱码；浏览器检查不作为 Android 原生恢复证明。
- `git diff --check` 和 U+FFFD 扫描将在验收文档提交前再次执行。

## Android lint 状态

`lintDebug` 已运行。首次运行发现本次新增文件头读取使用了 API 33 方法，以及仓库基线已有的 Media3 opt-in 错误；API 33 依赖已改为 API 24 可用实现。复跑后只剩 1 个本分支未引入的错误：`MainActivity.kt` 注册已标注 `@UnstableApi` 的 `ProductionRuntimePlugin` 时未 opt-in。该文件与制作链路不属于 Issue #1/#2，本分支未修改，也未通过 baseline 或忽略规则掩盖。

## 最终集成：独立模拟器步骤

不得使用共享模拟器。准备一个独立、可清理的测试 AVD 和无敏感内容的素材：普通 JPEG、PNG、WebP，各一张高分辨率图片，一张接近 15 MB 上限的图片，一张超过上限的图片，以及一个改名为图片扩展名的无效文本文件。

1. 安装本次 debug APK，进入“舌象与面部观察”。分别从系统相册选择普通图片和调用系统相机拍摄；确认立即出现“正在导入图片”，页面可响应，随后出现预览且可继续生成报告。
2. 分别取消相册和相机；确认显示可解释终态，按钮恢复可用，不保留永久忙碌状态。
3. 依次选择高分辨率、接近上限、超过上限和无效文件；确认后台处理期间无 ANR，成功图片归一化为 JPEG、最长边不超过 2048，超限和无效文件映射到稳定错误。
4. 打开开发者选项“不要保留活动”。在相册或相机前台时让应用 Activity 重建，再完成或取消操作；确认只出现一个成功或失败终态。
5. 在外部相册或相机位于前台时，使用 `adb shell am kill com.hongtai.aiagent` 模拟后台进程回收；不要使用 `force-stop`。返回应用后确认恢复成功，或显示明确的可重试恢复失败，且不会尝试完成已经丢失的旧 WebView Promise。
6. 对选择和拍摄按钮做连续快速点击；确认只存在一个权威操作，所有终态都解除忙碌状态。
7. 在该独立 AVD 上运行 `PrivateMediaStoreInstrumentationTest`，检查真实私有化、JPEG、尺寸限制和临时文件清理；测试结束后清理 AVD 测试数据。
8. 检查 logcat 与 WebView 控制台，确认没有输出媒体内容、凭据、完整来源标识或应用私有存储位置。

## 最终集成：物理真机步骤

1. 至少选择一台 Android 13+ 设备验证系统 Photo Picker，并选择一台 Android 8 至 12 设备验证 `ACTION_OPEN_DOCUMENT` 回退。
2. 在至少两个不同厂商相机上验证确认、取消、横竖屏切换、带 EXIF 旋转的照片和高像素照片；检查画面方向、JPEG 归一化和界面响应。
3. 在外部相机停留较长时间后返回，并在开发者选项“不要保留活动”和真实内存压力下重复；确认成功或可重试失败均只消费一次。
4. 验证云相册或可撤销授权来源在读取权限失效时映射为 `MEDIA_READ_FAILED`，且页面恢复可操作。
5. 验证超过 15 MB、损坏文件、空拍摄文件和拍摄暂存文件丢失时的错误与清理行为；此类破坏性场景使用测试素材和调试检查，不接触用户真实照片。
6. 观察导入期间主线程帧、ANR 与内存峰值；重点覆盖高像素 JPEG、PNG、WebP，以及设备实际支持的 HEIF/HEIC。

## 仍待物理真机验证

- OEM 相机对外部 Activity 重建、进程回收和 URI 授权的实际差异。
- Android 13+ Photo Picker 与 Android 8 至 12 文档选择器的真实返回顺序和授权持续时间。
- 高像素图片在低内存设备上的解码、旋转、缩放、压缩耗时和无 ANR 表现。
- OEM 产生的 EXIF 旋转与设备支持的 HEIF/HEIC 解码结果。
- instrumentation 测试的设备端实际执行；本次仅完成 JVM 测试和 AndroidTest 编译，按要求未操作共享模拟器。
- 上述基线 `lintDebug` Media3 opt-in 错误仍需由独立任务处理。
