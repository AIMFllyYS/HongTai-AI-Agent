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

脚本使用 JDK 21 `keytool` 创建长期非 Debug 身份，并把目录 ACL 限制为当前用户、SYSTEM 和 Administrators。keystore、properties 或公有证书任一目标已存在时都会失败，绝不覆盖。控制台只显示 properties 路径与公有证书 SHA-256，不显示口令。

外部 properties 文件只包含四个必要字段：

```properties
storeFile=C:/absolute/path/outside/repository/hongtai-release.jks
storePassword=replace-with-secret
keyAlias=hongtai-release
keyPassword=replace-with-secret
```

`storeFile` 必须是已存在的绝对文件，alias 不得为 `androiddebugkey`。仓库中的 `android/keystore.properties.example` 只是无秘密的字段模板；真实 properties、keystore 和口令不得进入 Git、日志、Issue、截图或聊天记录。

## 构建与主机验签

使用默认外部目录：

```powershell
.\scripts\build-android-release.ps1
```

也可显式选择外部 properties：

```powershell
.\scripts\build-android-release.ps1 -SigningProperties "D:\受控备份盘\HongTai-signing\keystore.properties"
```

构建脚本依次执行 Web production build、Capacitor Android sync、`:app:testReleaseUnitTest`、`:app:lintRelease` 和 `:app:assembleRelease`。它只接受 `android/app/build/outputs/apk/release/app-release.apk`，并自动执行以下主机门禁：

- `zipalign -c -P 16 -v 4`；
- `aapt2 dump badging`，要求包名 `com.hongtai.aiagent`、`versionCode=4`、`versionName=0.0.1`；
- `apksigner verify --verbose --print-certs`，要求 v2/v3 均为 `true`，且 DN 不含 `Android Debug`；
- signer SHA-256 必须与 `android/release-certificate.sha256` 的公开证书锚点完全一致；
- 计算并打印 APK SHA-256。

release assemble、bundle、package、install 或 `validateSigning` 任务未提供有效外部配置时，Gradle 会 fail-closed。Debug 构建、JVM 测试和普通同步不依赖 release 私钥。

## 身份备份责任

第一次对外分发前，维护者必须确认以下材料已有离线、加密、可恢复的受控备份：release keystore、properties 中的两个口令、alias，以及公开证书指纹。备份恢复应由签名材料保管人演练，仓库只保存公开指纹锚点。

一旦首个 APK 已对外分发，丢失该 release 私钥或口令将无法为原应用身份产生可正常更新的后续 APK。不得通过生成新 key、改包名或要求降级安装来伪装连续升级。

## 安装与升级边界

Android Debug 证书与本 release 证书不是同一身份。已有 Debug/QA 安装不能直接升级为 release；进入 release 谱系前需要先备份允许导出的数据、卸载 Debug 包，再安装 release，卸载会清除应用私有数据。

进入 release 谱系后，后续候选必须使用同一 release 证书并递增 `versionCode`。普通升级命令是：

```powershell
adb install -r android\app\build\outputs\apk\release\app-release.apk
```

验收时不得使用 `-d`，也不得在升级前卸载；应核对安装前后证书指纹、版本、`firstInstallTime` 和受控私有样本哈希。当前主机签名链的 Android 安装/升级证据仍待独立端测补充，不能从构建成功推导。

Play App Signing、CI 密钥库或远程签名服务只是未来可选的部署方案。启用前需单独设计权限、备份、审计和迁移流程；当前仓库未配置这些系统。
