# Issue #5 正式 Release 签名链设计

> 状态：已按用户给出的 Issue #5 范围批准执行。用户要求无人值守推进，因此本设计在不扩大分发渠道、云服务或远端凭据管理范围的前提下自主选择最小安全方案。

## 目标

为 `com.hongtai.aiagent` 建立一个可复现、默认拒绝未签名产物、且不把私钥或口令写入 Git 的非 Debug release 签名链。完成后必须能构建并验签正式候选 APK，记录公开证书指纹、版本和 APK SHA-256，并在 Android 环境验证同一 release 证书的普通升级路径。

本 Issue 只解决构建签名身份与升级证明。它不把素材库、发布功能、HEIF 兼容、视频稳定性或尚未完成的物理真机链路描述为成熟，也不把 Android 运行时用于保护 API Key 的 Keystore 当成 APK 构建签名 keystore。

## 当前根因

- `android/app/build.gradle.kts` 定义了 `release` build type，却没有 `signingConfigs.release`，标准构建只能产生 unsigned release。
- 历史 `app-release.apk` 是构建后用 Android Debug 证书签名的 QA 产物；文件名或 Gradle variant 不代表正式发布身份。
- 仓库没有 release 凭据入口、缺配置时的 fail-closed 门禁、证书指纹锚定、验签脚本或签名文件精确忽略规则。
- Debug v2→v3 的正常升级只证明同一 Debug 证书；Debug 安装无法直接覆盖为不同证书的 release 安装。

## 方案比较

### 方案 A：外部 properties + Gradle signingConfig（采用）

Gradle 从仓库外的 properties 文件读取 `storeFile`、`storePassword`、`keyAlias` 和 `keyPassword`，配置并绑定 release 签名。仓库只保存示例字段、非敏感公开证书 SHA-256 和验证工具。优点是符合 Android 官方模式、本地与未来 CI 可共用同一契约、改动集中且不会把秘密写进源码。

### 方案 B：仅使用 CI 环境变量

凭据只存在 CI Secret 和临时 runner。安全集中，但仓库当前没有 CI，必须同时设计 runner 权限、fork 隔离、临时文件清理和凭据轮换，超出 Issue #5 的最小范围。Issue #23 建立 CI 后可让 CI 生成相同格式的外部 properties 文件，无需改变本次 Gradle 契约。

### 方案 C：Play App Signing 或外部签名服务

让仓库只产出 AAB/unsigned artifact，由 Play 或专用签名环境保存 app-signing key。该方案依赖分发渠道和外部账户决策，也无法单独覆盖当前直接 APK 验收，因此本轮不采用。

## 设计

### 签名材料与身份

- 初始化脚本只在目标不存在时创建首个长期 release keystore；任何已有目标都会使脚本退出，禁止静默覆盖签名身份。
- keystore 和 properties 放在仓库外的当前用户受控目录；properties 使用当前用户 ACL，不向控制台输出任何口令。
- 密钥使用非 Debug alias、RSA 3072 位和不少于 25 年的有效期；证书主体只包含项目组织身份，不包含个人信息。
- 生成后的公开证书 SHA-256 写入仓库中的锚定文件。公开指纹不是秘密，后续每次 release 都必须与它一致。
- 若应用曾经使用另一把正式密钥对外分发，必须停止使用本初始化路径并恢复原密钥；本设计不提供自动换钥或绕过 Android 更新身份校验的机制。

### Gradle 边界

- `android/app/build.gradle.kts` 只从 `HONGTAI_RELEASE_SIGNING_PROPERTIES` 指向的外部文件加载四个必要字段。
- release 打包、bundle 或签名相关任务缺少文件、字段、keystore 或非绝对路径时直接失败；Debug 构建、JVM 测试和不需要签名的日常检查不受影响。
- `release` build type 必须显式绑定 `signingConfigs.release`，不得回退 `signingConfigs.debug`，不得在异常中输出属性值。
- 正式候选的 `versionCode` 从历史最高值 3 增加到 4；`versionName` 继续使用首个公开版本名 `0.0.1`，Android 升级身份仍以单调 `versionCode` 和同一证书为准。

### 发布验证工具

- 初始化脚本负责安全创建 keystore、外部 properties 和公开指纹，且拒绝覆盖。
- 构建脚本负责 Web build、Capacitor sync、release 单测、lint 和 APK 构建；随后使用 Android SDK 的 `zipalign`、`aapt2` 和 `apksigner` 验证唯一候选。
- 验证必须拒绝 `CN=Android Debug`，确认 APK Signature Scheme v2/v3、`com.hongtai.aiagent`、预期版本和锚定证书 SHA-256，并输出最终 APK SHA-256。脚本不得把口令放进命令行或日志。
- 缺少 SDK/JDK/签名材料时脚本给出不含秘密的明确失败，不生成“已验收”记录。

### Android 端测

在可用 Android 设备或模拟器上，以同一 release key 构建低一位 `versionCode` 的受控基线和当前候选：

1. 安装 release 基线；
2. 写入固定、无个人信息的应用私有样本；
3. 使用 `adb install -r` 安装候选，不使用 `-d`、不卸载；
4. 核对签名指纹一致、版本递增、`firstInstallTime` 不变、样本 SHA-256 不变；
5. 冷启动并确认真实进程存在。

模拟器证据只能证明 Android PackageManager 的真实安装/升级链，不能冒充物理真机。若本机没有连接物理设备，验收记录必须如实保留该边界。

## 文件职责

- `android/app/build.gradle.kts`：唯一的 Android release signingConfig 与 fail-closed 入口。
- `android/keystore.properties.example`：无秘密的字段契约。
- `android/release-certificate.sha256`：公开证书身份锚点。
- `scripts/init-android-release-signing.ps1`：一次性、安全、拒绝覆盖的本机签名身份初始化。
- `scripts/build-android-release.ps1`：确定性构建、验签和摘要输出。
- `tests/android-release-signing.test.ts`：签名边界的静态与脚本契约回归。
- `docs/Android发布签名与升级指南.md`：操作、备份、升级和 Debug→release 边界。
- `docs/验收/2026-08-10-android-release-signing.md`：本次实际证据，不覆盖历史 QA 记录。

## 安全与失败语义

- `.jks`、`.keystore`、本地 signing properties 和生成的临时验证目录必须被精确忽略；提交前扫描跟踪文件与暂存差异中的敏感字段。
- 失败不删除已有 keystore、历史 APK、成功产物或应用数据。临时基线构建在工作树外进行，完成后保留到验收结束，再由用户决定清理。
- 缺少密钥、指纹不一致、Debug 证书、版本不递增、签名方案缺失或 APK 不唯一都属于发布失败；不得降级为警告或继续分发。

## 验收

- 新签名回归测试先失败后通过，`pnpm check` 通过。
- 无 `HONGTAI_RELEASE_SIGNING_PROPERTIES` 时 release 打包明确失败；Debug/JVM 基线仍通过。
- 受控非 Debug keystore 初始化成功且二次运行拒绝覆盖。
- `testReleaseUnitTest`、`lintRelease`、`assembleRelease`、Web build 和 Capacitor sync 通过。
- `zipalign`、`aapt2`、`apksigner`、证书锚定和 APK SHA-256 检查通过。
- 可用 Android 环境上的同 release 证书普通升级与私有样本保留通过；没有物理设备时明确记录“模拟器通过、物理真机未验证”。
- `git diff --check`、UTF-8/U+FFFD、秘密扫描通过；只精确暂存 Issue #5 文件并创建本地 commit，不推送。
