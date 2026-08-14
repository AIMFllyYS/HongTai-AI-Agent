# v0.1.9 五脏六腑传统观察知识库验收

> 日期：2026-08-15
>
> 阶段：三阶段功能扩展的阶段 1
>
> 结论：`0.1.9` / `versionCode=17` Release 候选通过自动化、主机签名构建和 API 35 模拟器端测；没有物理手机、真实 AI Key、公开上传或公网哈希回验，因此不是正式发布证明。

## 范围

- 新增独立 UTF-8 Markdown 知识库，长度保持在约 4 千至 1 万字符的任务范围内。
- 诊察 Prompt 将该 Markdown 作为唯一传统观察知识上下文完整注入。
- 紧凑响应增加 `wellnessReference`，通过既有 `diagnosis-report.v1.wellnessReferences` 安全投影给页面。
- 齿痕、白苔、舌红不允许直接等同于湿气重、胃寒、心火旺；状态参考必须有不确定表达和“单张图片不能据此诊断”声明。
- 不改 Android I/O、图片选择器、页面 DTO 边界或应用内既有 SVG。

## 自动化证据

- 诊察知识与 Flow 定向测试：15/15 通过。
- `pnpm check`：类型检查、ESLint、273/273 测试通过。
- `pnpm --filter @hongtai/web build`：638 个模块转换成功。
- `git diff --check`：通过。
- 变更文件 UTF-8 与 U+FFFD 扫描：未发现替换字符。

## Release APK

- 构建入口：`scripts/build-android-release.ps1`。
- 归档文件：`output/apk-archive/HongTai-AI-Agent-release-v0.1.9.apk`。
- 包名：`com.hongtai.aiagent`。
- 版本：`0.1.9` / `versionCode=17`。
- 大小：25,963,545 字节。
- APK SHA-256：`a98b1a608ed5c2c56c9015020588ac0d011a4fc9b12b9256799745b2ad31bc70`。
- 证书 SHA-256：`54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`。
- Release 构建完成 `testReleaseUnitTest`、`lintRelease`、四 ABI native build、16 KiB zipalign、v2/v3 签名和包身份后验。

## API 35 端测

- 设备：只读覆盖层 AVD `SciChatApi35`，`sdk_gphone64_x86_64`，API 35，ADB `emulator-5554`。
- 普通升级：从同证书 `0.1.6/code13` 执行 `adb install --no-streaming -r`，未卸载、未使用 `-d`，结果 `Success`。
- 数据保留证据：`firstInstallTime` 继续为 `2026-08-12 12:14:26`；安装后 PackageManager 为 `0.1.9/code17`。
- 冷启动：`topResumedActivity` 为 `com.hongtai.aiagent/.MainActivity`，目标包未见 crash 或 ANR。
- 页面链路：真实底部 AI 导航可打开“舌象与面部观察”；舌象/面部模式卡片与图片选择区域正常显示；设置页可打开“应用信息”。
- 更新记录：应用信息真实显示版本 0.1.9、构建号 17，以及五脏六腑传统观察、组合判断、不确定参考和图片质量边界。

## 明确未验证

- 模拟器没有配置真实 AI Key，因此没有发送私人图片或声称真实视觉模型已返回本知识库增强结果；模型输入和输出安全边界由 Flow/Schema 测试验证。
- 没有物理 Android 手机，不能声称 OEM 相机、Photo Picker、真实网络、物理真机色彩或正常升级已通过。
- 没有更新 `download.html`，也没有公开上传 v0.1.9 或从公网重新下载核对哈希。
