# 2026-08-13 v0.1.6 模块化 AI 进度与自动更新验收

## 任务契约

### 目标

- 内容拆解、舌象观察和面部观察不再只显示无法解释的“正在生成”，而是展示五个固定业务模块的真实生成、校验、修复、成功或失败状态。
- 页面只展示通过模块 Zod 与业务语义校验的安全字段；正式结果仍须完整 Schema 校验并原子保存。
- 任务列表、任务详情、内容拆解、观察历史和观察报告在健康状态下自动更新，不要求用户手动刷新。
- 清除过去从半截 JSON 中用正则猜字段、字符数和 highlights 的残余实现。

### 非目标

- 不建设 Agent、工具调用、动态工作流、Prompt DSL、训练/Fine-tuning 平台或模型注册系统。
- 不增加固定轮询、WebSocket、后台服务、数据库、登录或云端任务队列。
- 不把模块半成品保存成正式报告，不向 UI 暴露 raw、reasoning、密钥、请求头、Cookie、私有图片 URI 或供应商对象。
- 本记录不把主机、浏览器或模拟器证据表述为物理真机或正式公开发布。

## 架构与实现结论

1. `packages/ai` 中的 `DiagnosisFlow` 和 `ContentAnalysisFlow` 各自固定执行五个顺序模块。每个领域有公共规则 Prompt，每个模块有独立 Prompt 与模块 Schema；正常路径五次调用，每个失败模块最多追加一次格式/语义修复。
2. Provider 的 SSE/UTF-8 delta 继续作为传输流。模块闭合并通过 Zod 与语义校验后，Flow 才产生累计 `structured-generation-progress.v1`；页面不解析半截 JSON。
3. `APP_RUNTIME_CONTRACT_VERSION` 已推进为 `app-runtime.v2`。分析按 `taskId`、诊察按 `sessionId` single-flight，并支持活动快照重放；终态记录持久化后才发送 `completed/failed`。
4. `ValidatedModuleProgress` 只通过两个领域白名单 presenter 显示已校验字段。当前模块使用流光骨架，修复状态有明确文案，成功模块约 600ms 渐显；reduced-motion 下禁用动画。
5. 任务投影和事件统一先持久化再通知。列表读取期间到达的 upsert、delete 或报告终态会按事件游标回放；请求序列阻止旧读取晚返回覆盖新状态。
6. 旧 `StructuredStreamProgress`、`StructuredStreamPreview`、正则字段猜测测试和 `.structured-stream-progress*` CSS 已删除。Provider stream、CLI stream printer 与私有运行审计保留。

## 权威状态与失败边界

- 任务以持久化 `task.json`/`events.jsonl` 为权威；内容拆解以正式 `content-analysis.v1` 为权威；图片观察以正式 `diagnosis-report.v1` 为权威。
- 运行期模块快照只存在内存中。模块失败时页面可暂时保留已完成模块用于解释进展，但不产生正式结果文件；后续模块保持未开始。
- WebView 或进程退出后不恢复模块半成品，既有恢复契约把遗留运行写为明确失败或中断；用户重试从模块 1 开始。
- 健康状态下页面通过窄订阅自动更新；只有读取或订阅失败时保留“重新读取”动作，`useAppResume` 仅是返回前台后的兜底。

## 自动化与视觉证据

Phase 4 最终代码已通过：

- Web 定向测试：27/27。
- `pnpm check`：256/256，包含全 workspace typecheck 与 lint。
- `pnpm --filter @hongtai/web build`：642 个模块完成 production build；仅保留既有的大 chunk 非阻断提示。
- `git diff --check`：通过，仅有 Git 的 LF/CRLF 工作区提示。
- 严格 UTF-8 与 U+FFFD 扫描：391 个当前文本文件，0 个非法 UTF-8，0 个 U+FFFD。

真实 Chromium 视觉验收覆盖生成、修复、失败和保存状态：

- [桌面 1440×1000](../../output/playwright/module-progress-diagnosis-desktop.png)
- [移动端 390px 生成状态](../../output/playwright/module-progress-diagnosis-390px.png)
- [移动端结构校正](../../output/playwright/module-progress-repair-390px.png)
- [移动端模块失败](../../output/playwright/module-progress-failure-390px.png)
- [移动端正式保存](../../output/playwright/module-progress-saving-390px.png)
- [视觉与可访问性审计记录](../../output/playwright/module-progress-visual-audit.txt)

浏览器实测无横向溢出；可访问性只用一个 `aria-live=polite` 状态句播报变化；reduced-motion 下流光与渐显 animation 均为 `none`；控制台 0 error、0 warning。

Phase 5 清洗后的最终代码已通过：

- 清洗与相邻页面定向测试：21/21。
- `pnpm check`：257/257，包含全 workspace typecheck 与 lint。
- `pnpm --filter @hongtai/web build`：642 个模块完成 production build；仅保留既有的大 chunk 非阻断提示。
- 严格 UTF-8 与 U+FFFD 扫描：389 个当前文本文件，0 个非法 UTF-8，0 个 U+FFFD。
- `git diff --check`：通过，仅有 Git 的 LF/CRLF 工作区提示。
- 排除负向回归测试、历史交接与 2026-08-11 历史验收后，`StructuredStreamPreview`、字符计数、正则 highlights 和旧 CSS 实现引用为 0；CLI stream printer、Provider SSE 与隔离运行审计仍存在。

Phase 6 候选版本已通过：

- 版本与应用信息定向测试：26/26。
- `pnpm check`：258/258，包含全 workspace typecheck 与 lint。
- `pnpm --filter @hongtai/web build`：642 个模块完成 production build；仅保留既有的大 chunk 非阻断提示。
- 严格 UTF-8 与 U+FFFD 扫描：443 个受管文本文件，0 个非法 UTF-8，0 个 U+FFFD；`git diff --check` 通过。
- 仓库 Release 入口重新执行 Web build、Capacitor sync、`:app:testReleaseUnitTest`、`:app:lintRelease`、四 ABI 原生构建和 `:app:assembleRelease`，148 个 Gradle 任务全部执行成功。
- Debug 与 instrumentation APK 另行使用 JDK 21 和 SDK 35 构建成功；最初两次直调 Gradle 分别因 shell 未注入 SDK、未选择 JDK 21 而在配置/编译初始化阶段安全失败，没有通过降级 Java 或改代码绕过。复用 Release 脚本的环境发现规则后，113 个任务成功。

## v0.1.6 已签名候选 APK

| 项目 | 结果 |
| --- | --- |
| 精确来源提交 | `f39d409b9bb41f92858abdab9c8d93a4e34e3d55` |
| 交付文件 | `android/app/build/outputs/apk/release/HongTai-AI-Agent-release-v0.1.6.apk`（Git 忽略，不提交） |
| 包身份 | `com.hongtai.aiagent`，`versionName=0.1.6`，`versionCode=13` |
| 字节数 | 25,952,093 |
| APK SHA-256 | `9804CEF8EE96ED80C106E472E09DD16D3A5FF5F1210873132588004DECDDEAEA` |
| 签名 | non-debuggable；v2=true、v3=true；单一 RSA 3072 signer |
| 证书 SHA-256 | `54DF122CD4F99720C613737815385E771BFAEB17715C160AED178062AB5B2FDE`，与仓库公开锚点一致 |
| ABI | `arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64` |

固定交付名副本与 Gradle 原始 `app-release.apk` 的字节数和 SHA-256 完全一致。APK 仍在 `android/app/build/` 忽略目录内，未进入 Git，也没有上传公网。

## API 35 模拟器证据

- 唯一设备为 `SciChatApi35`：Android 15 / API 35 / x86_64，model `sdk_gphone64_x86_64`，`ro.kernel.qemu=1`，明确不是物理设备。
- 升级前安装为同一 Release 证书的 v0.1.5/code12，`firstInstallTime=2026-08-12 12:14:26`。执行 `adb install --no-streaming -r` 安装候选，未卸载、未清数据、未使用 `-d`；安装成功后为 v0.1.6/code13，`firstInstallTime` 保持，冷启动 `Status: ok`，致命日志为空。
- 冷启动截图为 `C:\Users\AIMFl\AppData\Local\Temp\hongtai-v016-release-cold.png`，454,549 字节，SHA-256 `F4310ED0E2DACE3B043162AFAEE494D8D15CAEABD2C47EA1F6B380C85FE6E616`；目视确认宏泰页面不是白屏，品牌、入口、底部导航和中文均正常。
- 为避免 Debug 签名污染 Release 主实例，先正常关闭持久化实例，再以 `-read-only -no-snapshot-save` 启动同一 AVD 的临时覆盖层。覆盖层内安装 Debug 与 test APK，实际运行 `AndroidJUnitRunner` 得到 `OK (7 tests)`：5 项执行成功、2 项因只适用于 API 24/25 而按设计 skip；Media3 真实渲染测试通过，致命日志为空。
- 退出只读覆盖层后，从持久化磁盘冷启动主实例；包仍为 v0.1.6/code13、同一签名、原 `firstInstallTime`，冷启动 `Status: ok` 且致命日志为空，证明 Debug 测试未污染主实例。
- 本轮没有可用 AI 调用额度，因此没有把模拟器上的固定 Flow 单元/集成测试或浏览器安全投影验收表述为真实供应商 AI E2E；真实模型、真实图片、真实 MP4 与云端 TTS 仍属于物理设备门禁。

## Git 阶段证据

- `9ba1cee fix(core): persist task state before notifying views`
- `7b2ddda feat(ai): generate validated reports in five modules`
- `1e32473 feat(runtime): expose validated generation progress`
- `4936659 feat(web): show live validated module progress`
- `47aa7a2 refactor: remove raw-json stream preview residue`
- `f39d409 chore(release): prepare v0.1.6 code 13`

各阶段均使用明确路径暂存并本地提交；未推送功能分支。根工作区用户文件 `HongTai.zip` 未被读取、移动、删除、覆盖或暂存。

## 发布边界

Android 源码身份已推进为 `0.1.6` / `versionCode=13`，正式签名 APK、主机后验和 API 35 模拟器门禁均已通过；当前公开下载页仍为已验证的 `0.1.5` / `versionCode=12`。因此当前准确身份是“v0.1.6 已签名候选 APK”，不是正式公开发布。

即使候选 APK 与模拟器门禁通过，只要没有真实 Android 设备完成同签名正常升级、旧数据保留、舌诊、面诊、链接拆解、本地 MP4 与前后台恢复，就只能称为“已签名候选 APK”。物理设备通过前不得公开上传 v0.1.6、切换下载页、合并 `main` 或推送远端。
