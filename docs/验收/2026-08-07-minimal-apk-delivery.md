# 2026-08-07 最小独立 APK 交付验收

## 交付物

- 应用包名：`com.hongtai.aiagent`
- 版本：`0.1.0`（`versionCode 1`）
- 产物：`android/app/build/outputs/apk/debug/app-debug.apk`
- SHA-256：`DE33C899B2FA84665D6DBCED355CB19BB1EC95C3CAF1F2CB07F2A13745A71503`
- 文件大小：`36,802,961` bytes
- 签名：Android debug 签名，仅用于演示安装；尚未配置发布签名。

## 已完成的自动验证

1. `pnpm check`：TypeScript、ESLint 与根测试全部通过（152 项）。
2. `pnpm --filter @hongtai/capacitor-runtime test`：APK 薄运行时测试通过（17 项），覆盖七阶段复用、私有任务文件、设置密钥不回传、内容拆解、观察报告、追问和原生 I/O 映射。
3. `pnpm --filter @hongtai/web build`：React 静态资源成功打包。
4. `pnpm exec cap sync android`：Web 资源成功同步到 Android 工程。
5. `:app:testDebugUnitTest :app:assembleDebug --no-daemon`：Kotlin 单元测试和 debug APK 构建通过。
6. 原生单测覆盖 Keystore-only AI 请求字段、下载声明长度校验和有大小上限的媒体导入；入口边界测试确认 APK 页面不导入 Node、`.env` 或 CLI 运行时，也没有应用级 SQLCipher 任务数据库依赖。
7. 使用开发机受忽略 `.env` 仅在终端进程中完成 OpenAI 兼容文本、视觉和 ASR 三项无个人数据探针；三项均成功。视觉探针使用 512×512 合成 JPEG，以满足该供应商的最小图片输入要求。该 `.env` 未复制到工程、资源或 APK。

## 实现边界

- React 仅调用 `AppRuntime` 并显示 DTO；不会解析 CLI 文案或读取 Android 文件路径。
- `IngestPipeline`、`ContentAnalysisFlow`、`DiagnosisFlow` 仍是唯一业务流程；Android 只提供 Keystore、私有文件、网络、媒体和 Photo Picker I/O。
- 任务、正式 JSON、媒体和观察图片都在应用私有目录；完整 API Key 只在 Keystore 安全槽中读取。
- 制作、素材、发布明确标记为“尚未接入”，没有伪造上传、生成或发布结果。

## 尚未完成的物理设备验收

当前环境没有可用 `adb`，因此本记录只证明“可构建 APK”，不声称已经安装或真机通过。收到设备后，应补测安装启动、设置页写入 Key、Photo Picker、退后台行为、真实平台链接、内容拆解和舌象/面部观察追问；并记录设备型号、Android/API 版本和安装结果。
