# Android 发布签名与升级指南

本文是 release 签名身份的操作指南。它不替代[当前能力与发布状态](当前能力与发布状态.md)中的发布门禁，也不把主机构建成功表述为物理设备验收或正式分发完成。

## 首次初始化

签名材料保管人在可信 Windows 主机的仓库根目录执行：

```powershell
.\scripts\init-android-release-signing.ps1
```

默认目录为当前用户 `%APPDATA%\HongTai-AI-Agent\signing`。确需指定其他仓库外目录时使用：

```powershell
.\scripts\init-android-release-signing.ps1 -SigningDirectory "D:\受控备份盘\HongTai-signing"
```

脚本在规范化仓库根或执行任何外部工具前，先检查原始仓库路径；从指向仓库的 Windows junction、符号链接等 reparse point 启动时会立即拒绝。目标目录等于或位于仓库内部、目标路径链经过 reparse point 时也会保守拒绝，不能借外部别名把材料写回仓库。

`SigningDirectory` 必须完全不存在；已有空目录或含其他文件的目录都会原样拒绝，脚本不会接管或修改其 ACL。初始化只对本次新建的同父级唯一 staging 目录设置当前用户、SYSTEM 和 Administrators ACL，在其中用 JDK 21 `keytool` 生成并验证 keystore、properties、公有证书三件套，再用一次目录 rename 发布为最终目录。发布和清理 helper 都要求 staging 名严格符合脚本生成的 32 位小写 GUID 格式、父目录与预期父目录精确一致，并自行逐段拒绝 reparse point；清理还会在删除前验证全部目录项，任何三件套文件本身是 reparse point 时也会拒绝。发布前失败只精确清理通过上述验证的本次 staging 文件和空目录，普通目录或最终材料目录不能被当作 staging 清理，最终目录不会出现半套材料。控制台只显示 properties 路径与公有证书 SHA-256，不显示口令。

外部 properties 文件只包含四个必要字段：

```properties
storeFile=C:/absolute/path/outside/repository/hongtai-release.jks
storePassword=replace-with-secret
keyAlias=hongtai-release
keyPassword=replace-with-secret
```

properties 文件由初始化脚本写成 UTF-8 无 BOM，Gradle 也显式按 UTF-8 Reader 读取，因此仓库外中文目录可以原样使用。properties 文件和 `storeFile` 的原始值都必须是绝对路径，Gradle 在任何项目路径解析前先拒绝相对值；两者还必须位于仓库外，`storeFile` 必须存在，alias 不得为 `androiddebugkey`。构建入口从 reparse point 指向的仓库别名启动时会在调用 pnpm 或 Gradle 前拒绝，也拒绝 properties 路径链中的 reparse point；Gradle 还比较 normalized path 与 `toRealPath()` 并逐段检查符号链接，外部 junction 指回仓库不能绕过边界。仓库中的 `android/keystore.properties.example` 只是无秘密的字段模板；真实 properties、keystore 和口令不得进入 Git、日志、Issue、截图或聊天记录。根 `.gitignore` 对任意层的常见 keystore 与 `keystore.properties` 另有防御性忽略，但它不是替代仓库外存储的安全边界。

## 构建与主机验签

使用默认外部目录：

```powershell
.\scripts\build-android-release.ps1
```

也可显式选择外部 properties：

```powershell
.\scripts\build-android-release.ps1 -SigningProperties "D:\受控备份盘\HongTai-signing\keystore.properties"
```

构建脚本每次都依次执行 Web production build、Capacitor Android sync、`:app:testReleaseUnitTest`、`:app:lintRelease` 和 `:app:assembleRelease`，不提供跳过构建并验收旧 APK 的参数。Capacitor sync 后会立即对已知生成文件 `android/app/src/main/res/xml/config.xml` 做窄范围确定性格式规范化：保留所有非空语义行，只移除空白行和行尾空白，写回 UTF-8 无 BOM、LF 与单个 EOF newline；不会恢复整个文件或隐藏 Capacitor 的内容变化。它只接受本次流程产生的 `android/app/build/outputs/apk/release/app-release.apk`，并自动执行以下主机门禁：

- `zipalign -c -P 16 -v 4`；
- `aapt2 dump badging`，要求包名 `com.hongtai.aiagent`、当前源码候选 `versionCode=14`、`versionName=0.1.6`；
- `apksigner verify --verbose --print-certs`，要求 v2/v3 均为 `true`，且 DN 不含 `Android Debug`；
- signer SHA-256 必须与 `android/release-certificate.sha256` 的公开证书锚点完全一致；
- 计算并打印 APK SHA-256。

当前 AGP 实际 task inventory 中，`assembleRelease`、`bundleRelease`、`packageRelease`、`packageReleaseBundle`、`packageReleaseUniversalApk`、`signReleaseBundle`、`installRelease` 与 `validateSigningRelease` 都属于受控 release 产物/签名入口；实际 task graph 包含其中任一项而未提供有效外部配置时就会 fail-closed。因此聚合 `:app:assemble`、`:app:bundle` 和 `:app:build` 也不能产生 unsigned release。`testReleaseUnitTest`、`assembleUnitTest`、`lintRelease`、`packageReleaseResources` 等非终端检查/资源任务不会被签名门禁误伤；显式 Debug 构建、JVM 测试和普通同步同样不依赖 release 私钥。升级 AGP 后必须重新运行 `:app:tasks --all` 与本仓库 Windows 行为测试，核对新增产物入口。

## 身份备份责任

第一次对外分发前，维护者必须确认以下材料已有离线、加密、可恢复的受控备份：release keystore、properties 中的两个口令、alias，以及公开证书指纹。备份恢复应由签名材料保管人演练，仓库只保存公开指纹锚点。

一旦首个 APK 已对外分发，丢失该 release 私钥或口令将无法为原应用身份产生可正常更新的后续 APK。不得通过生成新 key、改包名或要求降级安装来伪装连续升级。

## 安装与升级边界

Android Debug 证书与本 release 证书不是同一身份。已有 Debug/QA 安装不能直接升级为 release；当前公开推荐的 v0.1.4/code11 就属于 Debug 谱系。进入 release 谱系前需要先备份允许导出的数据、卸载 Debug 包，再安装 release，卸载会清除应用私有数据。不得把更高 `versionCode` 当作跨证书升级手段；Android 会先校验签名并拒绝不兼容覆盖。

进入 release 谱系后，后续候选必须使用同一 release 证书并递增 `versionCode`。普通升级命令是：

```powershell
adb install -r android\app\build\outputs\apk\release\app-release.apk
```

验收时不得使用 `-d`，也不得在升级前卸载；应核对安装前后证书指纹、版本、`firstInstallTime` 和受控本地数据。2026-08-10 已在 API 35 read-only 模拟器上以同一 release 证书完成 v3→v4 普通升级：`firstInstallTime` 保持、本地档案标记保留，升级后冷启动通过。2026-08-13 又以同一正式证书完成 v3→v0.1.5/code12 普通升级，`firstInstallTime` 保持；同一轮把公开 v0.1.4 Debug 覆盖为 v0.1.5 Release 时，系统按预期返回 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` 并保留旧安装。两者都只是模拟器证据；物理真机、公开用户的数据迁移方案与其他发布门禁仍未完成，整体仍不可正式分发。详细数值见[签名链验收](验收/2026-08-10-android-release-signing.md)与[v0.1.5 救援验收](验收/2026-08-13-v015-lineage-recovery.md)。

Play App Signing、CI 密钥库或远程签名服务只是未来可选的部署方案。启用前需单独设计权限、备份、审计和迁移流程；当前仓库未配置这些系统。
