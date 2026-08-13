# Android APK 统一命名与版本归档设计

> 日期：2026-08-14
> 状态：用户已明确要求采用“应用名-构建类型-版本号”命名，并保留每个版本的独立 APK；本设计据此执行。

## 目标

- Debug APK 固定命名为 `HongTai-AI-Agent-debug-v<versionName>.apk`。
- Release APK 固定命名为 `HongTai-AI-Agent-release-v<versionName>.apk`。
- Gradle 的 `app-debug.apk`、`app-release.apk` 只视为可覆盖的临时构建输出。
- 验证通过的交付 APK 统一复制到仓库内本地目录 `output/apk-archive/`，按版本长期并列保留。
- 同名归档文件已存在时：内容相同则幂等复用；内容不同则失败，禁止静默覆盖。
- APK 二进制继续不进入 Git；命名规则、构建逻辑、版本索引和哈希验收进入 Git。
- 当前源码推进到 `versionName=0.1.7`、`versionCode=15`，分别生成 Debug 与团队证书签名 Release。

## 方案比较

### 方案 A：只重命名 Gradle 输出

优点是改动少；缺点是 `android/app/build/` 会被清理或下一次构建替换，无法满足长期留存。拒绝。

### 方案 B：把所有 APK 二进制提交 Git

优点是随仓库同步；缺点是仓库快速膨胀，历史二进制难以审查，也不符合现有 APK 忽略边界。拒绝。

### 方案 C：本地归档目录加可追溯索引

构建仍使用标准 Gradle 输出，验证后复制到 `output/apk-archive/`；归档脚本拒绝不同内容覆盖。二进制本地保留，Git 只保存规范、索引和哈希证据。该方案最小、可维护，选用。

## 文件与职责

- `scripts/archive-android-apk.ps1`：唯一归档入口；校验源文件、生成规范文件名、执行不覆盖复制并返回 SHA-256。
- `scripts/build-android-debug.ps1`：完成 Web build、Capacitor sync、Debug 测试/lint/build、包身份校验，再调用归档入口。
- `scripts/build-android-release.ps1`：保留现有 fail-closed 签名门禁，在全部后验通过后调用归档入口。
- `output/apk-archive/`：所有可验证历史 APK 的本地统一目录；二进制不进入 Git。
- `docs/APK产物命名与归档规范.md`：长期规则、人工操作和故障处理。
- `docs/验收/2026-08-14-v017-apk-archive.md`：本次 v0.1.7 的源码提交、文件、字节数、哈希、签名与验证边界。

## 归档规则

1. 文件名中的版本号必须来自 APK 包内 `versionName`，不能由人工自由填写。
2. Debug 与 Release 的包内 `versionCode/versionName` 必须与当前源码一致。
3. Debug 和 Release 使用不同签名身份，不得互相宣称可覆盖升级。
4. 归档文件存在且 SHA-256 相同时，脚本返回已有文件，不重复写入。
5. 归档文件存在且 SHA-256 不同时，脚本立即失败；必须推进版本号，不能覆盖历史。
6. Android instrumentation test APK 不属于用户交付 APK，不进入版本归档。
7. 历史错误身份 APK可以保留为证据，但不得放入“可运行推荐版本”清单。
8. 找不到原始 APK 的历史版本只登记事实，不从新源码伪造一个同版本 APK。

## v0.1.7 版本边界

v0.1.7 不增加新的业务能力。它继承 v0.1.6 code 14 的单次结构化 AI 生成、运行期深度思考、自动状态更新和媒体选择器生命周期修复，专门修复 APK 交付辨识与历史留存问题。版本推进为 code 15，避免再次出现两个候选都显示 `0.1.6` 的混淆。

## 验收

- 测试先证明旧代码不满足 `0.1.7/15` 和归档命名契约。
- Debug/Release 构建均产生规范文件名。
- 连续归档同一文件是幂等的；不同内容写入同名目标必须失败。
- `aapt` 实读两个 APK 均为 `com.hongtai.aiagent`、`0.1.7/15`。
- Release 通过 non-debuggable、zipalign、v2/v3、证书锚点和四 ABI 后验。
- 输出 APK、哈希和来源提交写入验收记录。
- `pnpm check`、Web build、Android 定向门禁、UTF-8/U+FFFD 与 `git diff --check` 通过。
