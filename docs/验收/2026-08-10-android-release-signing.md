# 2026-08-10 Android release 签名链验收

## 任务契约

- 目标：建立仓库外、非 Debug、fail-closed 的 Android release 签名链，验证唯一 release APK 的公开身份，并独立验证同一 release 证书的普通升级路径。
- 允许修改：Android build/release 配置、两份 PowerShell 工具、聚焦测试、签名操作指南、当前状态文档与本验收记录；独立端测只在工作区外临时源码和 read-only AVD 会话内操作。
- 明确不做：不修改运行时 Android Keystore、UI、业务 Flow、Capacitor 组合逻辑、CI、Play Console；不操作物理设备，不把模拟器证据写成真机证据。
- 状态权威来源：Gradle release variant、`aapt2` manifest 元数据、`apksigner` 证书摘要、仓库公开证书锚点、APK 文件 SHA-256、Android PackageManager 与真实 UI 可访问树/截图。

## TDD 与失败路径

- 基线：`92761e8` 上的本次 Issue #5 工作树。
- RED：首次运行 `pnpm exec tsx --test tests/android-release-signing.test.ts`，2 项均按预期失败；缺少 Gradle release 签名入口及脚本/锚点。
- GREEN：实现后同一聚焦测试 2/2 通过。
- 无 `HONGTAI_RELEASE_SIGNING_PROPERTIES` 执行 `:app:assembleRelease --no-daemon`：配置阶段以 `Release signing configuration is required via HONGTAI_RELEASE_SIGNING_PROPERTIES` 安全失败，未输出字段值或私有路径。
- `:app:testDebugUnitTest --no-daemon`：通过，说明缺少 release 配置不阻断 Debug/JVM 回归。

### 规格审查后的安全补证

- 在基线 `bf2173e` 上扩展聚焦测试，新增 task graph、仓库外路径、根忽略、无 stale APK bypass 与秘密生命周期守护；新增断言首次运行 2/2 按预期失败，实现后与既有 Android boundary 合计 14/14 通过。
- 无 `HONGTAI_RELEASE_SIGNING_PROPERTIES` 分别执行 `:app:assemble --no-daemon` 与 `:app:build --no-daemon`，两者的实际 task graph 都包含 release 产物任务，并在任何 task 执行前以同一安全错误 fail-closed；显式 `:app:testDebugUnitTest` 仍通过。
- 使用工作区内无秘密占位路径验证：初始化脚本拒绝仓库内 signing directory 且未创建目录；构建脚本拒绝仓库内 properties；Gradle 拒绝仓库内 properties，也拒绝仓库外 properties 指向仓库内 `storeFile`。错误均未输出字段值或 properties 内容；占位文件在验证后删除。
- 根 `.gitignore` 已防御性忽略任意层 `*.jks`、`*.keystore`、`*.p12` 和 `keystore.properties`，不影响 `keystore.properties.example`。
- `build-android-release.ps1` 已移除跳过 fresh build、直接验收固定旧 APK 的参数；每次调用均执行 Web build、Capacitor sync、release test/lint/assemble 后再验签。
- 初始化脚本把两个随机口令的生成纳入受保护 `try/finally`，并在 `finally` 清除环境变量、口令和完整明文 properties 变量。对已有正式材料复跑仍拒绝覆盖，三个最终目标哈希保持不变。

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

规格修复后的完整构建脚本再次从 Web build 与 Capacitor sync 开始执行；Gradle 96 个 actionable task 中 8 个执行、88 个 up-to-date，release test/lint/assemble 与全部主机后验通过。新鲜 APK SHA-256 仍为上述 `0dc5a2a9a1a8abe8cd1f98691c1aa5c99049461f9fbb7cfd8b9f4913a98f67d5`，因此未改写既有 Android 端测候选 SHA 结论。

构建中保留既有的 Vite 大 chunk 提示、Capacitor `flatDir` 提示和 Media3 deprecated 编译提示；本次没有新增对应实现，也没有把 warning 表述为 error 或顺手扩修。

## Android 安装与升级

独立端测已于同日补充完成，环境与边界如下：

- 设备是 AVD `SciChatApi35` 的 API 35、`sdk_gphone64_x86_64` **模拟器**，`ro.kernel.qemu=1`；启动参数含 `-read-only -no-snapshot-save -no-window -no-audio`，不是物理真机证据。
- 启动前 ADB 设备列表为空；会话结束后执行 `adb -s emulator-5554 emu kill`，ADB 再次为空。read-only 会话不作为底层 AVD 持久状态证据。
- 会话启动时存在历史 `0.1.0 (1)` Debug 包。端测先拉取 APK 并记录 Debug DN/证书，再在确认 qemu、AVD 名与 read-only 进程参数后仅从本会话卸载；该准备步骤与后续 release v3→v4 升级分开，升级前没有卸载 release baseline。

同证书 v3 baseline 来自 `049e97ba1cdee25d0807765d4453fd9b746e4d6e` 的 `git archive` 临时源码；只在工作区外把 `versionCode` 与构建脚本预期值从 4 改为 3，再以 frozen lockfile 和同一默认仓库外签名配置构建：

- baseline：`0.0.1 (3)`，APK SHA-256 `d9bb081e0494fc1d39bf11aaa4f70363383ffefaac76063369325464b79ae591`；
- candidate：`0.0.1 (4)`，APK SHA-256 `0dc5a2a9a1a8abe8cd1f98691c1aa5c99049461f9fbb7cfd8b9f4913a98f67d5`；
- 两者包名均为 `com.hongtai.aiagent`，v2/v3 均为 `true`，DN 均为 `CN=HongTai AI Agent Release, O=HongTai AI Agent, C=CN`，证书 SHA-256 均为 `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`。

安装与普通升级均显式绑定唯一 emulator serial：

- baseline 使用 `adb -s emulator-5554 install --no-streaming <baseline-v3-app-release.apk>`，未带 `-d`，输出 `Success`。PackageManager 记录 `firstInstallTime=2026-08-09 11:45:59`、`lastUpdateTime=2026-08-09 11:45:59`。
- baseline 冷启动 `com.hongtai.aiagent/.MainActivity` 返回 `Status: ok`、`LaunchState: COLD`，进程 PID 为 `3656`。
- 通过真实 UI 进入“设置”→“建立本地档案”，在显示名输入框写入固定 ASCII 标记 `Issue5ReleaseUpgrade`，点击“保存本地档案”；可访问树显示“已保存到本机”，返回设置后档案卡片显示该标记。
- candidate 使用 `adb -s emulator-5554 install --no-streaming -r <candidate-v4-app-release.apk>`，升级前未卸载、命令未带 `-d`，输出 `Success`。PackageManager 变为 `0.0.1 (4)`，`firstInstallTime` 保持 `2026-08-09 11:45:59`，`lastUpdateTime` 更新为 `2026-08-09 11:49:45`。
- candidate 冷启动返回 `Status: ok`、`LaunchState: COLD`，进程 PID 为 `4715`；进入设置页后可访问树仍显示 `Issue5ReleaseUpgrade`，证明本地档案数据随普通升级保留。
- 从 PackageManager 安装路径拉取的升级后 APK SHA-256 仍为 candidate 的 `0dc5a2a9a1a8abe8cd1f98691c1aa5c99049461f9fbb7cfd8b9f4913a98f67d5`，证书摘要仍与公开锚点一致。

截图已保留在工作区外临时目录 `C:\Users\AIMFl\AppData\Local\Temp\HongTai-Issue5-Acceptance-20260810-003949-8f4a0b12`：baseline 的 `baseline-settings-confirm.png`（SHA-256 `e042aaabcf8d43eb6bdbf83750139688751d330afb861776362927bc7d02e9d0`）与升级后的 `upgraded-settings.png`（SHA-256 `044cbc24f4d56d990dce1eaa9b7902e1fdd576b49835cfaad33f4bb0c076d34b`）均已目视确认基础设置界面正常且标记可见。baseline/candidate 保护副本、SHA 记录、UI XML 与其他过程截图也保留在同一目录，未清理。

已有 Debug/QA 安装因证书不同不能直接升级为本 release；Debug→release 仍需要卸载重装，这一边界不应混入已经通过的同 release 证书普通升级结论。

## 当前结论

Issue #5 的仓库外非 Debug 签名、Gradle fail-closed、主机 APK 身份后验，以及 API 35 模拟器上的同 release 证书 v3→v4 普通升级、档案保留和基础冷启动均已通过。物理真机和其他发布 Issue/门禁仍然有效，因此该 APK 仍不是正式可分发结论。
