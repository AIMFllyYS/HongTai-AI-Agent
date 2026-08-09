# 2026-08-10 Android 7.x HEIF 实现证据

## 结论

Issue #6 实现已完成基础验证：字节权威探测、API 24/25 decoder 路由、原生限制/错误边界、可追溯 fixture、四 ABI 动态库和 16 KiB 对齐均已落地。API 24/25 真实 DocumentsUI 端测待后续独立验收，因此本文不是设备通过声明。

实现基线为 `a900a54`，实现提交为本文所在的 `feat(android): support HEIF on API 24 and 25` 提交。构建包保持 `versionCode=4`、`versionName=0.0.1`；本轮没有为内部实现重复递增版本。

## 已观察证据

- focused JVM：`ImageFormatProbeTest`、`ObservationImageDecoderSelectorTest`、`PrivateMediaImportPolicyTest` 通过；provider MIME/文件名不能覆盖字节权威。
- native/instrumentation：四 ABI `externalNativeBuildDebug` 通过，`compileDebugAndroidTestKotlin` 通过；设备用例已编译但未在本阶段启动 AVD。
- fixture：`baseline.heic` SHA-256 `e5e6042f34cc86c46215f50636e55e9f9e41c0d49f59e931f7f24b1aa427dfe6`；无 EXIF、含真实 `irot` 的 90° CW fixture SHA-256 `77169628d144a56c603a41d4dd82d580a3b5ce2f061418ed0fd6efbeedbca266`。完整生成来源与负例 hash 见相邻 provenance 清单。
- 供应链：首次获取、二次 no-op 和损坏 archive 拒绝已观察；损坏输入未改变已验证缓存。源码 archive hash 与 lock 一致。
- ELF：四 ABI 的三个动态库全部 `LOAD` alignment `0x4000`；`DT_NEEDED` 证明 libheif → libde265、JNI → libheif + libde265。
- debug APK：精确包含 12 个目标 `.so`，`zipalign -c -P 16 4` 通过；本次静态检查 APK SHA-256 为 `06dac8412ce3db318b4427d457de891f101b4655cfb65480117255a5f4936778`。
- release builder：不带降级参数的发布构建通过；release APK 为 25,893,547 字节，精确包含 12 个目标 `.so`，四 ABI `LOAD` alignment 均为 `0x4000`，`zipalign -c -P 16 4` 通过，APK SHA-256 为 `4811589735f73a995a41e0def91f150f64b3ae3654f9ba50ee7d452bf863b117`。

## 待后续端测

- API 24 与 API 25 分别冷启动独立 AVD，经系统 DocumentsUI 走真实相册选择路径；
- baseline 与 `irot` fixture 的预览、输出 JPEG 尺寸/四角像素、唯一终态和 `.source`/`.part` 清理；
- malformed、外部引用、AVIF、超限和 native unavailable 的稳定错误终态；
- API 26 与 API 35 的平台 HEIF 路径及普通 JPEG/PNG/WebP 回归；
- sanitized crash/ANR 扫描、候选 APK hash 与 AVD API/ABI/冷启动事实。

即使后续 x86_64 AVD 通过，也不能代替物理 Android 7.x、ARM ABI runtime、OEM HEIC 相机产物与低内存压力证据。
