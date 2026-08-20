# v0.1.18 Release 验收记录（公网已发布，真机待验）

## 目标与范围

- 用户可感知结果：批次 11 制作页可点性修复、数字人原声、下载类型纠正与模拟器 Media3 成片进入独立签名 Android Release，并完成公网文件回验。
- 架构归属：Web UI、共享 core/ai、Capacitor 组合层与 Android Media3 / 下载 I/O。
- 明确不做：不声称物理真机、Agent 真实 `generatePlan` 或 B 站 APK 真网已通过。

## 候选身份

| 项目 | 结果 |
| --- | --- |
| applicationId | `com.hongtai.aiagent` |
| versionName | `0.1.18` |
| versionCode | `26` |
| 文件名 | `HongTai-AI-Agent-release-v0.1.18.apk` |
| 文件大小 | `21,932,925` bytes |
| APK SHA-256 | `a5d39c07c62a37af42f70242d17eb3f73c47e05e4bbeea51759e5a3c931072cf` |
| 证书 SHA-256 | `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde` |
| 签名主体 | `CN=HongTai AI Agent Release, O=HongTai AI Agent, C=CN` |
| 公网地址 | `https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.18.apk` |

## 主机验证

- 官方入口 `scripts/build-android-release.ps1`：通过。
- `pnpm --filter @hongtai/web build`：通过（脚本内执行）。
- Capacitor Android sync 与 `normalize-capacitor-config.ps1`：通过。
- Gradle `:app:testReleaseUnitTest`：通过。
- Gradle `:app:lintRelease`：通过。
- Gradle `:app:assembleRelease`：通过，四 ABI。
- 16 KiB zipalign、包身份、版本、v2/v3 正式签名、证书锚点和 APK SHA-256 后验：通过。
- 完整 `pnpm check`：通过，根测试 501/501，`@hongtai/capacitor-runtime` 121/121。

## 模拟器覆盖升级

设备：AVD `hongtai-api35`，`sdk_gphone64_x86_64`，API 35，ADB `emulator-5554`。

1. `adb install --no-streaming -r` 安装归档 `HongTai-AI-Agent-release-v0.1.17.apk`：Success，`versionCode=25`、`versionName=0.1.17`。
2. 同样命令安装归档 `HongTai-AI-Agent-release-v0.1.18.apk`：Success，未使用 `-d`，未卸载。
3. `firstInstallTime=2026-08-19 17:53:58` 保持不变；`lastUpdateTime` 更新为 `2026-08-19 18:04:29`；`versionCode=26`、`versionName=0.1.18`。
4. `am force-stop` 后冷启动 `com.hongtai.aiagent/.MainActivity`：开屏后进入拆解首页，中文与底栏正常，无密钥展示。

截图：

- [冷启动开屏](2026-08-20-batch11/emulator-upgrade-v0.1.18-home.png)
- [首页就绪](2026-08-20-batch11/emulator-upgrade-v0.1.18-home-ready.png)

## 真实性边界

- Media3 成片证据来自同一 AVD 上的 Release instrumentation，见 [批次 11 Media3 验收](2026-08-20-batch11-media3.md)。
- 模拟器 WebView 无法用 `adb input` 走完数字人/Agent UI；本机无成功拆解任务。
- 未在「AI 设置」写入任何 Provider Key。

## 当前发布状态

本文件记录的 `v0.1.18` 已完成固定公网地址上传，并从公网重新下载核对得到与本地归档一致的 21,932,925 字节和 SHA-256 `a5d39c07c62a37af42f70242d17eb3f73c47e05e4bbeea51759e5a3c931072cf`；`download.html` 现推荐公开的 `v0.1.18`。公开分发只证明文件身份和下载链路已回验，不等于物理 Android 真机、真实 AI Provider 或两条制作主链已经验收通过。
