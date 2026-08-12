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

#### 第二轮规格审查补证

- 在基线 `574de73` 上先扩展聚焦测试：要求 task graph 只匹配五个终端 release 产物任务，并要求两个 PowerShell 入口逐段拒绝 reparse point。生产实现未修改时测试 2/2 按预期失败；最小实现后同一测试 2/2 通过。
- 无签名配置实际执行 `:app:testReleaseUnitTest --dry-run`、`:app:assembleUnitTest --dry-run`、`:app:lintRelease --dry-run` 与 `:app:packageReleaseResources --dry-run`，四者均成功且没有触发签名门禁；`testReleaseUnitTest`、lint 和资源 task 不再因名称中含 `Release` 而误伤。
- 无签名配置实际执行 `:app:assemble --no-daemon` 与 `:app:build --no-daemon`，两者仍因 task graph 含 `assembleRelease` 而在执行前安全失败，聚合任务的 fail-closed 未被削弱。
- 在仓库外创建精确临时 junction 指向仓库根，验证初始化目录和构建 properties 路径都会因路径链含 reparse point 而拒绝，初始化未创建目标；Gradle 也分别拒绝经 junction 访问的仓库内 properties，以及仓库外 properties 指向经 junction 访问的仓库内 `storeFile`。测试只使用无秘密占位字段，结束后已删除该 properties、junction 与空测试目录，仓库仍完整。

#### 第三轮规格审查补证

- 使用真实外部签名配置运行 `:app:tasks --all`，当前 AGP 列出的受控 release 产物/签名入口为：`installRelease`、`assembleRelease`、`bundleRelease`、`packageRelease`、`packageReleaseBundle`、`packageReleaseUniversalApk`、`signReleaseBundle`、`validateSigningRelease`。`packageReleaseResources`、`bundleReleaseResources` 与 `assembleReleaseUnitTest` 是非终端资源/测试任务，不纳入签名门禁。
- 新测试首次执行时 4 项中 3 项按预期失败：静态契约缺三个实际 bundle 终端任务；无签名配置同时请求 `packageReleaseBundle`、`packageReleaseUniversalApk`、`signReleaseBundle` 时错误地成功；真实 Windows junction 下 Gradle 仅靠 `File.canonicalFile` 也错误地接受了仓库内 `storeFile`。两个 PowerShell 入口的真实 junction 拒绝在该 RED 中已通过。
- 最小实现把三个 AGP 实际入口加入精确集合，并让 Gradle 比较 normalized path 与 `toRealPath()`、同时逐段检查符号链接。随后聚焦测试 4/4 通过：三个终端任务分别执行 dry-run 均安全失败，四个非产物任务的组合 dry-run 成功。
- Windows-only 自动行为测试在系统临时目录创建“仓库外 junction → 仓库根”和无秘密外部 properties，分别执行初始化脚本、构建脚本与 Gradle；三者均拒绝，初始化目标未生成。`finally` 先以非递归目录删除解除 junction，再删除占位 properties 与空临时目录，不递归遍历 junction，也不修改仓库内容；非 Windows 主机会明确 skip。

#### 第四轮代码质量补证

- 新增 5 项聚焦断言后首次运行 5/5 按预期失败：Gradle 尚未先拒绝原始相对 properties/`storeFile`，两个脚本尚未在规范化前拒绝仓库根 reparse point，初始化仍会接管既有目录并顺序移动三个最终文件，也没有独立的原子发布 helper。
- 最小实现后完整聚焦测试 7/7 通过。Gradle 实际执行分别确认相对 properties 与外部 properties 中的相对 `storeFile` 都以 absolute-path 错误拒绝，没有退化为仓库边界或文件存在错误。
- Windows-only 自动行为测试从系统临时目录建立“外部仓库 junction → 当前仓库”，再从 junction 路径启动初始化和构建脚本并传入真实仓库内部 candidate；两者均在 pnpm、keytool、ACL 或目标创建前以 repository reparse 错误拒绝，伪造的 pnpm marker 未生成，仓库目录 ACL 与三个签名目标均未变化。
- 初始化现在要求最终 `SigningDirectory` 完全不存在。以含 sentinel 的既有目录调用时安全失败，sentinel SHA-256、目录 SDDL 和 `AreAccessRulesProtected` 均保持不变。
- 三件套先在最终目录同父级的唯一 staging 目录内生成和验证，properties 写入最终 keystore 绝对路径，再通过一次 `[System.IO.Directory]::Move(staging, final)` 发布。独立 helper 的 final-conflict 行为测试确认发布失败后只精确清理本次 staging 三文件及空目录，既有 final sentinel 的 SHA-256 与 ACL 不变，最终目录没有混入任何签名目标。
- 无签名配置的 `:app:assemble --no-daemon` 与 `:app:build --no-daemon` 仍在 task 执行前以 required 错误 fail-closed；配置 JDK 21 后 `:app:testDebugUnitTest --no-daemon` 通过。错误均未输出字段值、properties 内容或私有路径。

#### 第五轮质量复审补证

- 在基线 `9f3625e` 上新增 cleanup 身份边界和中文 UTF-8 路径测试；生产实现未修改时目标测试 6/6 按预期失败。中文路径明确落入 `Release signing keystore must be an existing file`，证明 `Properties.load(InputStream)` 的 ISO-8859-1 语义无法读取初始化脚本生成的 UTF-8 路径；helper 则缺少 expected parent 与严格 staging 身份参数。
- Gradle 改为 `reader(Charsets.UTF_8)` 后，在系统临时目录创建 UTF-8 无 BOM、中文文件名的 properties 与中文 `storeFile` 占位文件，实际执行 `:app:testReleaseUnitTest --dry-run` 成功，不再落入 existing-file 错误。fixture 只含无秘密占位字段并已精确清理。
- 发布和清理 helper 现在都要求 `ExpectedParentDirectory`，并在任何文件操作前验证 normalized/full parent 精确匹配、staging leaf 符合 `^\.signing\.[0-9a-f]{32}\.staging$`，且 expected parent 与 staging 路径逐段不含 reparse point；清理还先验证所有目录项，三件套文件自身为 reparse point 时会整体拒绝。
- 真实误用回归把含三份占位材料的普通 final 目录传给 cleanup：helper 以 invalid-staging 错误拒绝，目录 ACL 和三个文件 SHA-256 均不变。合法 GUID staging 的独立回归则成功精确删除三文件及空目录；final-conflict 原子发布回归仍保持既有 final sentinel 的 SHA-256/ACL 不变并清理合法 staging。
- 完整聚焦测试 10/10 通过，既有 release task graph、相对路径、仓库/候选 junction、仓库别名启动、existing-dir ACL 和原子冲突矩阵均未回归。

#### 第六轮工程收口补证

- 原 833 行聚焦测试按职责拆为 contract 163 行、Gradle Windows 163 行、PowerShell Windows 245 行、transaction cleanup 249 行；共用的 Windows/Gradle/ACL 命令实现集中在 98 行的 `tests/support/android-release-signing.ts`，没有 re-export 壳。原 10 项覆盖全部保留，并新增 normalizer contract/unit、独立 ACL/atomic 职责及两项 transaction 预验证回归；四组 focused 在默认多文件并行模式下 15/15 通过，所有可写 fixture 都使用系统临时目录中的唯一目录，不读取或修改正式签名材料。
- transaction 新回归确认：合法 GUID staging 中存在 unexpected entry 时，cleanup 在删除任何 known file 前整体拒绝，三个 known SHA-256、unexpected SHA-256 与 staging ACL 均不变；known-name 目录 junction 作为 reparse entry 时同样先拒绝，外部 target、另外两个 known file 与 ACL 均不变，`finally` 先以非递归目录删除解除 junction，再精确清理空 fixture。现有 hardened helper 已满足这两项，新增测试作为真实 characterization 直接通过，没有为制造 RED 人为放宽生产门禁。
- `config.xml` 规范化 contract 与临时 fixture unit 在生产脚本不存在时 2/2 按预期 RED。最小实现新增 PS5.1 兼容 normalizer，并在 Capacitor sync 成功后立即调用；unit 确认 CRLF、行尾空白、空白行和 BOM 被规范为 UTF-8 无 BOM、LF、单个 EOF newline，同时自定义 widget/plugin 元素内容保持不变。
- 独立真实集成 gate 在当前工作树先记录完整 pre-status 与 `config.xml` SHA-256，再运行 `pnpm exec cap sync android` 和 normalizer；结果 `CONFIG_HASH_UNCHANGED=True`、`WORKTREE_STATUS_UNCHANGED=True`、`CONFIG_TRACKED_DIFF_COUNT=0`，`git diff --check` 通过。该 gate 不进入并发 `pnpm test`，避免真实 cap sync 与其他 repo 测试互扰。

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

第二轮任务名与 reparse-point 门禁修复后又执行了一次完整构建入口；Web build、Capacitor sync、release test/lint/assemble、zipalign、`aapt2`、`apksigner` 与证书锚点全部通过，Gradle 仍为 96 个 actionable task 中 8 个执行、88 个 up-to-date。APK SHA-256 仍未变化，因此 Android 端测候选身份与既有升级数值保持原结论，不重复启动 AVD。

第三轮补齐 bundle 产物入口与 Gradle `toRealPath()` 门禁后再次执行完整构建入口；同一组 Web、Capacitor、release 测试/lint/build 和主机验签全部通过，Gradle 仍为 96 个 actionable task 中 8 个执行、88 个 up-to-date，APK SHA-256 仍为 `0dc5a2a9a1a8abe8cd1f98691c1aa5c99049461f9fbb7cfd8b9f4913a98f67d5`。因此不改写既有 Android 端测候选身份，也不重复启动 AVD。

第四轮补上原始仓库根 reparse 门禁、原始绝对路径检查与原子目录发布后再次执行完整构建入口；Web build、Capacitor sync、release test/lint/assemble、zipalign、`aapt2`、`apksigner` 与证书锚点全部通过，Gradle 仍为 96 个 actionable task 中 8 个执行、88 个 up-to-date。APK SHA-256 仍为 `0dc5a2a9a1a8abe8cd1f98691c1aa5c99049461f9fbb7cfd8b9f4913a98f67d5`，所以 Android 端测候选身份与已有升级数值不变；本轮没有启动 AVD。

第五轮收紧 cleanup helper 并改用 UTF-8 Reader 后再次执行完整构建入口；Web build、Capacitor sync、release test/lint/assemble、zipalign、`aapt2`、`apksigner` 和公开证书锚点全部通过，Gradle 仍为 96 个 actionable task 中 8 个执行、88 个 up-to-date。APK SHA-256 仍为 `0dc5a2a9a1a8abe8cd1f98691c1aa5c99049461f9fbb7cfd8b9f4913a98f67d5`，没有改变既有 Android 端测候选身份；本轮未启动 AVD，也未修改仓库外正式签名材料。

第六轮把 normalizer 接入真实 release 入口后再次 fresh 执行完整构建；Web build、Capacitor sync、规范化、release test/lint/assemble、zipalign、`aapt2`、`apksigner` 与证书锚点全部通过，Gradle 96 个 actionable task 中 12 个执行、84 个 up-to-date。APK SHA-256 仍为 `0dc5a2a9a1a8abe8cd1f98691c1aa5c99049461f9fbb7cfd8b9f4913a98f67d5`，`config.xml` 在构建后仍无 tracked diff；未启动 AVD，既有 Android 端测候选身份不变。

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
