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

脚本先验证 SHA-256、唯一 revision 根、路径、重复项和链接项，再通过 staging 发布到已忽略的 `android/.native-deps/heif-sources/`。相同 lock 再次执行是可验证 no-op；缓存存在但 marker/hash 不匹配时会失败。正常 CMake 配置不访问网络，缺少已验证源码时直接停止。

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

当前实现、JVM 测试、instrumentation 编译、四 ABI 构建与静态打包检查已完成。API 24/25 的 DocumentsUI 真实选择、方向像素、终态和清理端测由后续独立验收执行；在其完成前不得写成 Android 7.x 设备已通过。物理 Android 7.x、ARM 运行、OEM 相机 HEIC 和真实低内存行为仍未验证。

## LGPL 分发责任

APK 动态链接未修改的 libheif 与 libde265。完整许可证、NOTICE 和 SPDX SBOM 位于 `android/third_party/heif/`。正式分发必须同时提供精确对应源码，或建立有负责人、联系渠道和有效期限的书面源码要约；占位要约不能发布。分发条款不得禁止用户为调试修改后的 LGPL 库进行逆向工程，且必须保留替换动态库的实际边界。签名 APK、构建成功或仓库中存在 lock 文件都不会自动履行这些义务。
