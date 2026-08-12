# Issue #6 Android 7.x HEIF/HEIC 兼容设计

日期：2026-08-10
状态：已批准方向，待按实施计划落地与验收

## 问题与目标

应用的 `minSdk` 是 24，但当前 `PrivateMediaImportPolicy` 仅把 provider MIME 或文件扩展名为 HEIC/HEIF 的输入送入既有 `BitmapFactory` 归一化链。Android 平台从 API 26 起才保证 HEIF 解码，因此“接受 `image/heic`”并不等于 API 24/25 能解码；provider MIME 与文件名还都可以伪造，不能作为图片格式的权威证据。

Issue #6 的用户可感知目标是：在 API 24 和 25 上，用户通过现有系统文档选择器选择一张**经字节确认且由 HEVC 编码的静态 HEIF/HEIC** 后，应用能在后台把它安全归一化为现有私有 JPEG，预览、观察报告和恢复终态契约保持不变。API 26+ 的 HEIF 和所有受支持普通图片继续走 Android 平台解码路径。

## 任务契约

### 允许修改

- `android/app` 的图片格式探测、私有图片归一化、JNI/CMake、Gradle、Android JVM 与 instrumentation 测试；
- 固定第三方源码、校验和、许可证、SBOM、源码提供与可重建说明所需的最小清单和脚本；
- Android 原生边界的根测试、Issue #6 操作指南、当前状态和日期验收记录。

### 明确不做

- 不把 provider MIME、扩展名或旧验收文案当作 API 24/25 兼容证明；
- 不采用来源不透明、版本陈旧或无法重建的 Maven AAR，也不静态链接 LGPL 解码器；
- 不新增编码器、AVIF、动态图/序列、多图选择、编辑器、远程转换服务、宽泛媒体权限或第二套图片业务 Flow；
- 不改变 `AppRuntime`、安全 `MediaReference`、页面文案或观察报告 Schema；
- 不改 CLI/Node 图片解码路径，不处理 Issue #7 的 `sharp` 漏洞；
- 不因 AVD 通过而宣称物理真机、OEM 相机产物或四种 CPU ABI 均已真实运行。

### 架构归属

本修复完全属于 Android I/O 层：

```text
content:// 系统来源
  -> 有界复制到私有 staging
  -> ImageFormatProbe（字节为权威来源）
  -> Android 版本与格式路由
       -> API 26+ HEIF / 所有 API 普通图片：平台 BitmapFactory
       -> API 24/25 confirmed HEIF/HEIC：LegacyHeifDecoder JNI
  -> 只应用一次方向
  -> 现有缩放、白底、JPEG 临时写入与原子发布
  -> 现有 PhotoOperation 单一终态
```

Kotlin 仍只决定平台 I/O 与解码适配，不决定观察业务、AI Prompt、UI 文案或跨层状态。Capacitor 组合层和 React 页面不感知使用了平台解码器还是旧系统 fallback。

## 格式权威来源与路由

### 有界字节探测

新增纯 Kotlin `ImageFormatProbe`，只读取已完成有界复制的私有 staging 文件。探测最多读取 64 KiB、最多遍历 64 个顶层 ISOBMFF box，并对 32 位长度、扩展长度、`size=0`、偏移加法和文件边界做溢出检查。

- JPEG、PNG、WebP 只由各自完整魔数确认；
- HEIF 候选必须存在结构合法的 `ftyp`，且 major/compatible brand 包含 HEVC HEIF 品牌（`heic`、`heix`、`hevc`、`hevx`、`heim`、`heis`、`hevm`、`hevs`）或通用 HEIF 品牌（`mif1`、`msf1`）；
- `avif`/`avis` 不进入本 fallback；通用 HEIF 品牌仍必须由 decoder-only libheif 确认 primary image 可由 libde265 解码；
- provider MIME 和扩展名仅用于错误上下文，不得把不匹配的字节升级为受支持格式；反过来，provider 错报为 JPEG 也不能掩盖已确认的 HEIF 字节。

因此，改名为 `.heic` 的文本、provider 声称 `image/heic` 的 PNG、损坏 `ftyp`、越界 box 与 AVIF 都不会进入原生 HEVC 解码器。真实 JPEG/PNG/WebP 即使扩展名错误，仍按自身字节签名走平台路径。

### 平台选择

| 设备与格式 | 解码器 | 说明 |
| --- | --- | --- |
| API 24/25 + confirmed HEIF/HEIC | `LegacyHeifDecoder` | 唯一 fallback；只接受 HEVC 静态 primary image |
| API 26+ + confirmed HEIF/HEIC | Android 平台 | 不加载 JNI fallback |
| API 24+ + JPEG/PNG/WebP | Android 平台 | 保持现有行为 |
| 未知、伪造、AVIF、损坏或不受支持序列 | 无 | 映射为稳定无效图片或超限终态 |

路由由一个可注入、可单测的 decoder selector 持有，`PrivateObservationImageNormalizer` 继续是私有 JPEG 归一化的唯一入口，不新增第二套导入流程。

## 固定原生依赖与构建边界

### 版本与链接

- libheif：`v1.23.1`，commit `2c4bbb54c2738d4a5efbbe3e5fa1d5d76bb88eb0`；
- libde265：`v1.1.1`，commit `4dd701fffac01632ffd5cabc5ef10deb56accba1`；
- Android NDK：`28.2.13676358`；CMake 使用仓库声明的固定版本；
- ABI：`arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64`；native min API 24；
- 产物：`libheif.so`、`libde265.so` 和最小 JNI 适配器 `libhongtai_heif.so` 均为动态库；应用代码不得吸收 LGPL 对象文件或启用 LTO 跨库合并。

libheif 只启用 libde265 HEVC decoder；关闭 x265 与全部 encoder、AOM/dav1d、JPEG/OpenJPEG、FFmpeg、示例、命令行工具、测试和无关插件。正式清单要以两个固定 commit 中实际存在的 CMake 选项为准，未知选项必须让配置失败，不能静默忽略。

所有 `.so` 使用 16 KiB page-size 兼容链接参数，并在四 ABI 上检查 ELF `LOAD` segment 对齐、动态依赖与 APK 内未压缩 native 库对齐。`zipalign -P 16` 只是 APK 级检查，不能替代 ELF 检查。

截至本设计落笔时，执行主机已安装 NDK `28.2.13676358`、CMake `3.22.1`、Android 24/25 platform 以及 `default;x86_64` system image；早期“主机缺少旧 API/NDK”的环境阻断已经消除。这个事实只代表工具就绪，尚未创建/启动专用 API 24/25 AVD，也没有产生任何解码或端测结论。

### 供应链与 LGPL 交付

构建不在 CMake 配置阶段隐式访问网络。仓库提交机器可读 lock 清单，分别记录固定下载 URL、tag、commit、source tar SHA-256、许可证、构建选项和 patch SHA-256；显式 fetch 脚本先下载到临时文件、核对 SHA-256，再原子发布到忽略的本机源码缓存。缺包、哈希不匹配、目录脏改或版本不一致均 fail closed。

分发材料同时包含：

- 两份完整 LGPL-3.0 许可证和版权声明；
- SPDX 或 CycloneDX SBOM，列明版本、commit、archive SHA、ABI 和动态链接关系；
- 对应源码归档的公开获取位置与校验和；若正式分发介质需要源码要约，则提供有效期限、联系渠道和交付方式；
- 本仓库实际 patch、CMake 配置和四 ABI 重建/替换说明，使接收方可以重建或替换 LGPL 动态库；
- 允许为调试修改库进行逆向工程的通知，不把 APK 签名机制描述成可阻止 LGPL 要求。

这组材料是发布门禁，不把“代码能编译”误写成许可证义务已经自动完成。

## 安全、像素和内存限制

现有 15 MiB 源文件上限继续生效，并在任何 native context 创建前检查非空文件。fallback 还必须执行以下限制：

- primary image 宽高均在 `1..8192`，源总像素不超过 `16,777,216`；
- 只解码一个静态 primary image；拒绝无 primary image、动画/序列依赖、外部引用和没有 HEVC decoder 的 item；
- 最终最长边不超过 3072，输出像素不超过 `9,437,184`，RGBA 输出预算不超过 36 MiB；
- 所有 `width * height * bytesPerPixel`、stride、plane、offset 和 box 长度使用有符号 64 位 checked arithmetic 后才转换为 native size；
- libheif 使用固定版本提供的 strict/default security limits，并进一步收紧最大尺寸、metadata/box、tiles 和线程数；不得关闭安全限制来兼容畸形样本；
- native 分配失败、`std::bad_alloc`、JNI pending exception、线程中断和 decoder 错误都必须释放资源，不得 `abort`、越界写或保留全局图片指针。

超过字节或像素预算统一映射到 `IMAGE_TOO_LARGE`；格式损坏、AVIF/序列或不受支持编码映射到 `IMAGE_INVALID`；库缺失、ABI 打包错误等实现故障映射到既有私有导入失败。原生错误详情不得把私有路径或图片内容带到 UI、日志、测试快照。

## JNI 生命周期与异常终态

JNI 适配器不保存跨调用的 `heif_context`、handle、image、文件描述符或 Java 全局图片引用。C++ 使用 RAII 封装 `heif_context_free`、`heif_image_handle_release`、`heif_image_release`、锁定像素和局部引用；每个 return/throw 路径都释放资源。native 错误先转换为小型稳定枚举，再由 Kotlin 映射为现有异常类型。

fallback 继续运行在现有单线程 `hongtai-photo-import` executor，不在 Activity result 或主线程执行。成功仍通过同目录临时 JPEG、`fsync` 与 rename 发布；失败不留下 `.source`、`.part`、半成品 JPEG 或伪成功记录。异常回到 `FileMediaPlugin` 后必须写入并只消费一个 `PhotoOperationTerminal`，恢复消费者和原始调用都解除忙碌，不能因 `UnsatisfiedLinkError`、native decode 错误或 OOM 永久停在 importing。

## 方向只应用一次

API 24/25 fallback 让 libheif 应用 HEIF `irot`/`imir` 等变换，并在结果上标记 `orientationApplied=true`；后续 Kotlin 不再读取或应用该源文件的 EXIF 方向。平台路径继续沿用当前一次性 EXIF 处理。禁止先由 libheif 旋转，再由通用 `ExifInterface` 二次旋转。

方向 fixture 必须用不对称色块和非方形尺寸，同时断言输出宽高与四角像素；仅比较“可解码”不足以发现二次旋转或镜像。

## Fixture 来源与真实性

instrumentation fixture 放在专用测试 assets，不进入 Web bundle 或生产媒体。每个二进制 fixture 必须有相邻 provenance 清单，记录：

- 原始像素如何由仓库内确定性脚本生成，禁止来源不明的用户照片；
- 编码工具、版本/commit、完整非秘密命令、编码参数和生成日期；
- 源像素、HEIC 文件及任何变异样本的 SHA-256；
- 权利/许可证来源；采用上游 fixture 时还要记录上游仓库、精确路径、commit 和许可证；
- 预期尺寸、方向、色块坐标、codec 与是否应成功。

优先使用仓库自己生成的合成色块。测试用 encoder 仅用于离线生成 fixture，不进入 APK，也不能被写成运行时编码能力。损坏、伪造 MIME 和超限 fixture 应从已记录的合成样本通过确定性变异脚本产生。

## 验收边界

自动化必须证明纯探测、路由、限制、异常与清理；四 ABI 构建与静态 ELF 检查证明被正确打包。真实端测必须分别在 API 24 和 25 的独立 AVD 通过系统 DocumentsUI 选择真实 fixture，并验证 UI 恢复、私有 JPEG、方向和终态；API 26 与 API 35 回归平台路径和普通 JPEG/PNG/WebP。

AVD 只真实运行对应模拟器 ABI，不能证明 ARM ABI 或低内存 OEM 设备。没有物理 Android 7.x 设备、OEM HEIC 相机产物和内存压力证据时，当前状态只能写“API 24/25 AVD fallback 通过，物理真机未验证”，不能写成全面兼容成熟。
