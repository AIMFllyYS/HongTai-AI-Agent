# v0.1.18 Release 候选验收（已本地归档，未公网上传）

## 目标与范围

- 用户可感知结果：批次 11 制作页可点性修复、数字人原声、下载类型纠正与模拟器 Media3 成片进入独立签名 Release 归档。
- 架构归属：Web UI、共享 core/ai、Capacitor 组合层与 Android Media3 / 下载 I/O。
- 明确不做：不改 `download.html` 推荐版本，不公网上传，不声称物理真机、Agent 真实 `generatePlan` 或 B 站 APK 真网已通过。

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

公开推荐版本仍是 `v0.1.17` / `versionCode=25`（21,932,117 字节，SHA-256 `1358dfa5d16fb6c4f25c2684e4a23b3773296167fe51069ce5b466a1a9212b53`）。

## 主机验证

- 官方入口 `scripts/build-android-release.ps1`：通过。
- `pnpm --filter @hongtai/web build`：通过（脚本内执行）。
- Capacitor Android sync 与 `normalize-capacitor-config.ps1`：通过。
- Gradle `:app:testReleaseUnitTest`：通过。
- Gradle `:app:lintRelease`：通过。
- Gradle `:app:assembleRelease`：通过，四 ABI。
- 16 KiB zipalign、包身份、版本、v2/v3 正式签名、证书锚点和 APK SHA-256 后验：通过。
- 定向版本谱系测试：源码 `0.1.18`/`26`，下载页仍 `0.1.17`/`25`。
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
- 本文件记录的是本地归档身份与模拟器覆盖升级，不等于公网分发或物理真机通过。
