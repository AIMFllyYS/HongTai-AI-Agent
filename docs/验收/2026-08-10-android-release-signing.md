# 2026-08-10 Android release 签名链主机验收

## 任务契约

- 目标：建立仓库外、非 Debug、fail-closed 的 Android release 签名链，并验证唯一 release APK 的公开身份。
- 允许修改：Android build/release 配置、两份 PowerShell 工具、聚焦测试、签名操作指南与当前状态文档。
- 明确不做：不修改运行时 Android Keystore、UI、业务 Flow、Capacitor 组合逻辑、CI、Play Console；不启动 AVD、不安装 APK、不伪造设备证据。
- 状态权威来源：Gradle release variant、`aapt2` manifest 元数据、`apksigner` 证书摘要、仓库公开证书锚点和 APK 文件 SHA-256。

## TDD 与失败路径

- 基线：`92761e8` 上的本次 Issue #5 工作树。
- RED：首次运行 `pnpm exec tsx --test tests/android-release-signing.test.ts`，2 项均按预期失败；缺少 Gradle release 签名入口及脚本/锚点。
- GREEN：实现后同一聚焦测试 2/2 通过。
- 无 `HONGTAI_RELEASE_SIGNING_PROPERTIES` 执行 `:app:assembleRelease --no-daemon`：配置阶段以 `Release signing configuration is required via HONGTAI_RELEASE_SIGNING_PROPERTIES` 安全失败，未输出字段值或私有路径。
- `:app:testDebugUnitTest --no-daemon`：通过，说明缺少 release 配置不阻断 Debug/JVM 回归。

## 初始化证据

- 默认仓库外目录成功创建 alias `hongtai-release` 的 RSA 3072 / SHA256withRSA 身份。
- 公有 DN：`CN=HongTai AI Agent Release, O=HongTai AI Agent, C=CN`。
- 公有证书 SHA-256：`54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`。
- 第二次初始化明确拒绝覆盖；keystore、properties、公有证书三个最终目标的 SHA-256 在拒绝前后均保持不变。验收未读取或输出 properties 内容。

## 主机 release 构建与验签

- 命令入口：`scripts/build-android-release.ps1`，使用真实仓库外 properties。
- Web production build：通过；Capacitor Android sync：通过。
- Gradle：`:app:testReleaseUnitTest :app:lintRelease :app:assembleRelease --no-daemon` 通过，共 96 个 task 执行；lint report 已生成且无 error。
- APK：`android/app/build/outputs/apk/release/app-release.apk`。
- 包名：`com.hongtai.aiagent`。
- 版本：`0.0.1 (4)`。
- zipalign：`-c -P 16 -v 4` 通过。
- APK Signature Scheme v2：`true`；v3：`true`；DN 不含 `Android Debug`。
- signer SHA-256 与 `android/release-certificate.sha256` 一致。
- APK SHA-256：`0dc5a2a9a1a8abe8cd1f98691c1aa5c99049461f9fbb7cfd8b9f4913a98f67d5`。

构建中保留既有的 Vite 大 chunk 提示、Capacitor `flatDir` 提示和 Media3 deprecated 编译提示；本次没有新增对应实现，也没有把 warning 表述为 error 或顺手扩修。

## Android 安装与升级

**待独立端测补充。** 本次按任务边界未启动 AVD、未连接或操作物理设备、未执行 `adb install`，因此没有 release v3→v4 普通升级、私有样本保留或冷启动 PID 证据。后续端测必须使用同一 release 证书，不带 `-d`、不先卸载，并记录设备分类、API、版本、证书、`firstInstallTime` 和受控样本哈希。

已有 Debug/QA 安装因证书不同不能直接升级为本 release；Debug→release 需要卸载重装，这一边界不应混入同 release 证书的普通升级结论。

## 当前结论

Issue #5 的仓库外非 Debug 签名、Gradle fail-closed 与主机 APK 身份后验已建立。Android 安装/升级仍待独立端测，其他发布 Issue 与物理真机门禁仍然有效，因此该 APK 不是正式可分发结论。
