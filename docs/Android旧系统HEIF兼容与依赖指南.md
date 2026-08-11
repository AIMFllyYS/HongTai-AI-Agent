# Android 旧系统 HEIF 兼容与依赖指南

> 适用范围：API 24/25 的单张 HEVC HEIF/HEIC 导入 fallback。API 26+ 与 JPEG、PNG、WebP 继续使用 Android 平台解码；不支持 AVIF、动画/序列或编码。

## 实现边界

系统 picker 的内容先按既有 15 MiB 上限流式复制到应用私有 staging 文件，再由最多读取 64 KiB、最多检查 64 个顶层 box 的字节探针判断格式。provider MIME 和扩展名不能把未知内容升级为图片。只有 API 24/25 且字节确认的 HEIF 候选进入 JNI；成功结果继续走唯一的缩放、白底、JPEG 临时写入与原子发布链。

fallback 只接受一个静态 HEVC primary image，并拒绝序列、外部 `iloc` 引用、AVIF、损坏容器和超限尺寸。源文件最长边上限 8192、总像素上限 16,777,216；输出最长边上限 3072、总像素上限 9,437,184、RGBA 输出预算上限 36 MiB。libheif 应用 `irot`/`imir` 后把结果标记为已定向，Kotlin 不再重复应用 EXIF。

## 固定依赖与获取

构建需要 JDK 21、Android NDK `28.2.13676358`、CMake `3.22.1` 和 API 24 SDK。依赖锁位于 `android/native-deps/heif-lock.json`：

- libheif 1.23.1，commit `2c4bbb54c2738d4a5efbbe3e5fa1d5d76bb88eb0`，archive SHA-256 `9fdb7410222a9fd12387f4332e3f93cf428c976ac16f1379fcd7f6415ebe03c0`；
- libde265 1.1.1，commit `4dd701fffac01632ffd5cabc5ef10deb56accba1`，archive SHA-256 `43b3629cfa11a6e12be4d1fe7b7857eeeb17c84ce113f87fa93b6ab7478db55b`。

显式获取并校验源码：

```powershell
.\scripts\fetch-android-heif-sources.ps1
```

离线构建可由保管人先按锁文件名准备两个 archive，再执行：

```powershell
.\scripts\fetch-android-heif-sources.ps1 -ArchiveDirectory .\verified-archives
```

脚本先验证 SHA-256、唯一 revision 根、路径、重复项和链接项，再通过 staging 发布到已忽略的 `android/.native-deps/heif-sources/`。相同 lock 再次执行是可验证 no-op；缓存存在但 marker/hash 不匹配时会失败。

日常 Gradle native configure/build 不调用下载分支，而是先执行纯离线 `verifyHeifNativeSources`：逐项核对 marker 的 commit、archive SHA-256、source tree SHA-256、patch set 四个字段，实时复算源码树，并在枚举普通文件前拒绝源码树、marker 或子项中的 reparse point、symlink 与 junction。验证不创建、下载、改写或删除文件，任何不一致都在 CMake 之前停止。`externalNativeBuildClean*` 与项目 `clean` 只清理生成物，不读取源码，因此不依赖 verifier；真实 configure/build 仍通过各自的前置依赖强制校验。需要从仓库外只读缓存构建时，可设置绝对路径 `HONGTAI_HEIF_SOURCE_CACHE`；相对路径会被拒绝，同一绝对路径同时传给验证脚本和 CMake。

## WebView 能力边界

生产 Web bundle 以 Chromium 89 为能力下限，标准 Android WebView provider 低于该版本时进入本地静态中文终态页。Huawei provider 的 product version 不按 Chromium major 编号，因此使用 Capacitor 的独立基线 10，而不是把它与 Chromium 89 比较、更不能配置成不可达到的永久拒绝值。该页仍不含脚本、外链、网络或自动跳转；它只表示当前运行组件不满足启动条件，不能替代 Huawei/MIUI 物理设备兼容性结论。

## 构建与静态核验

```powershell
Push-Location android
.\gradlew.bat :app:externalNativeBuildDebug :app:assembleDebug --no-daemon
Pop-Location
```

构建固定包含 `arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64`。每个 ABI 必须各有动态 `libde265.so`、`libheif.so`、`libhongtai_heif.so`，不得出现 x265、encoder、AV1/AVIF codec 或不透明 AAR。用对应 NDK 的 `llvm-readelf -lW` 确认所有 `LOAD` alignment 为 `0x4000`，用 `llvm-readelf -dW` 确认 `libheif.so` 动态依赖 `libde265.so`、第一方 JNI 动态依赖二者。APK 使用已安装 build-tools 核验：

```powershell
zipalign -c -P 16 4 android/app/build/outputs/apk/debug/app-debug.apk
```

## Fixture 与测试

instrumentation assets 仅含仓库脚本生成的 96×64 非对称色块及确定性变异，不进入生产 Web bundle。来源、host encoder 固定版本、预期方向、权利声明和 SHA-256 见 `android/app/src/androidTest/assets/heif/PROVENANCE.md` 与相邻清单。离线 encoder 只是测试数据生成工具，不是 APK 能力。

API 24、API 25 独立 x86_64 AVD 已分别通过 6/6 instrumentation，覆盖真实 HEVC 解码、方向像素、异常终态和临时文件清理；API 35 现代 WebView 还完成了 UI、bridge 与 Photo Picker 组合回归，这些都是 v5 历史端测。v6 主机 release 历史证据继续保留。当前 v7 候选已完成 `pnpm check`、Kotlin/Web 基础验证、正式 release builder、签名和四 ABI 静态后验，但尚未做设备端复验。待补的 Android 7.x 组合仍是在 WebView ≥89 的同一 API 24/25 设备上，通过真实系统 DocumentsUI 完成 UI + fallback 闭环；物理 Android 7.x、ARM 运行、OEM 相机 HEIC 和真实低内存行为也仍未验证。

## LGPL 分发责任

APK 动态链接未修改的 libheif 与 libde265。完整许可证、NOTICE 和 SPDX SBOM 位于 `android/third_party/heif/`。正式分发必须同时提供精确对应源码，或建立有负责人、联系渠道和有效期限的书面源码要约；占位要约不能发布。分发条款不得禁止用户为调试修改后的 LGPL 库进行逆向工程，且必须保留替换动态库的实际边界。签名 APK、构建成功或仓库中存在 lock 文件都不会自动履行这些义务。
