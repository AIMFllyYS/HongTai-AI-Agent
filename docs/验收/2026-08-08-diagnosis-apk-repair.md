# 2026-08-08 图片观察 APK 修复验收

## 验收范围

本次只修复应用界面层、Capacitor 适配层与 Kotlin 原生能力层之间的图片入口和错误透传，不修改七阶段采集流程、平台解析器、AI Prompt、报告 Schema 或内容拆解逻辑。

修复内容：

- 相册与相机图片进入 AI 传输前，统一规范为最长边不超过 2048 像素、质量 90 的 JPEG；
- 原始输入上限与 CLI 对齐为 15MB，只接受 JPEG、PNG、WebP；
- 图片过大和图片无效分别保留稳定业务码与安全原生码；
- 报告失败状态会持久化，但原始 AI 错误不再被成功返回值吞掉；
- debug APK 升级为 `versionCode=2`、`versionName=0.2.0`；
- Capacitor bridge payload 日志关闭，避免写入型 API Key 出现在 Logcat。

Android 不新增 `CAMERA` 或相册运行时权限。系统 Photo Picker 和 `ACTION_IMAGE_CAPTURE + FileProvider` 本身不要求应用直接读取整个相册或持有相机权限。

## 自动门禁

- `pnpm check`：通过，173 项测试全部成功；
- `pnpm --filter @hongtai/capacitor-runtime test`：通过，22 项测试全部成功；
- Web 生产构建：通过；
- `:app:testDebugUnitTest`：通过；
- `:app:connectedDebugAndroidTest`：通过，真实 Content URI 图片导入后成为受限 JPEG；
- `:app:assembleDebug`：通过；
- `git diff --check`：通过；
- UTF-8 `U+FFFD` 扫描：通过。

## 真实运行验收

环境：Android Emulator `sdk_gphone64_x86_64`，API 35。

1. 使用主工作区现有 `.env` 运行 CLI 图片观察对照组，真实生成 `diagnosis-report.v1`，随后追问成功。
2. 在 APK 设置页写入同一组连接参数；API Key 只写入 Keystore，页面重载不回显。
3. APK 内文本、视觉、ASR 三项能力分别探测，全部显示“测试通过”。
4. 从系统 Photo Picker 选择已由 CLI 验证的舌象图片：
   - 私有导入结果：`image/jpeg`，25,898 字节；
   - 会话状态：`succeeded`；
   - 正式报告：4,618 字节；
   - 页面真实展示结构化观察报告。
5. 在报告页完成一次真实追问，本地保存两条 `completed` 消息，角色为 `user`、`assistant`。
6. 从页面启动系统相机，拍摄并确认返回：
   - 私有导入结果：JPEG，39,230 字节；
   - 图片尺寸：1392×1856；
   - 页面预览正常，“生成观察报告”按钮可用；
   - 相机临时目录已清空。
7. 强制停止并重启应用后，已保存报告、原图和两条追问历史均能重新读取。

## 安全扫描

- APK 中没有 `.env` 条目；
- APK 二进制中没有本次测试 API Key；
- Logcat 中没有本次测试 API Key；
- Logcat 中没有 `ERR_IMAGE_*`、`ERR_AI_*` 或崩溃记录；
- API Key 不通过 React 页面回读。

## 交付物

- APK：`C:\Users\AIMFl\.codex\worktrees\aec9\HongTai-AI-Agent\android\app\build\outputs\apk\debug\app-debug.apk`
- 文件大小：15,953,905 字节
- SHA-256：`13C5C0E5100A58FFEA2A7024658BF442858C7D5DD69843E915FD28027ABB0329`
- 版本：`0.2.0 (2)`

这是经过模拟器真实安装和端到端验证的 debug APK，不声明为 release 包或物理真机验收结果。模拟器相机使用虚拟摄像头场景；物理设备交付前仍建议补一次真机相机与相册抽验。
