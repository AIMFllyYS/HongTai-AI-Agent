# 2026-08-13 v0.1.6 单次结构化生成、深度思考与媒体选择生命周期纠偏验收

## 当前结论

`v0.1.6` / `versionCode=13` 候选已被真实端测否决，不得上传、分发或复用版本号；当前修复源码已推进到 `v0.1.6` / `versionCode=14`。否决原因不是模型不支持流式输出，而是实现把五个页面展示板块错误地变成五次串行模型请求，并在系统视频选择器正常返回时重载 WebView。当前实现已收敛为：

- 舌象/面部观察正常路径一次视觉结构化流式请求；
- 内容拆解正常路径一次文本结构化流式请求；
- 同一响应投影成五个已校验展示板块，不增加五次网络往返；
- 小米 MiMo 与阶跃星辰在 Provider 边界匹配各自推理字段，页面显示运行期“深度思考”；
- 完整文档无效时最多一次整体格式修复，诊察修复不再携带私有图片；
- 系统视频选择器正常返回时保留原 WebView、Promise 和运行任务；
- 正式 `diagnosis-report.v1` / `content-analysis.v1` 仍须完整校验并原子保存。

这仍是简单 AI 调用，不是 Agent、工具调用循环、动态工作流或新后端。

## 根因与最小修复

### 视频导入中断

外部媒体选择器使应用经历 `inactive → active`，旧恢复逻辑把这个正常生命周期边沿误判为 WebView 执行失联并主动重载。重载会销毁当前 JavaScript Promise，并把所有运行任务按恢复契约写成中断。

修复只调整生命周期所有权：已登记且正常返回的系统 Activity 关闭自己的操作登记并继续原调用；只有确认进程或 WebView 确实重建时才执行中断对账。没有新增相册权限、后台服务或另一套任务状态机。

### AI 延迟与上下文浪费

五次串行请求把页面的五个展示阶段误当成五个模型阶段，重复发送前置上下文并叠加五次推理首 token 延迟。当前两条 Flow 各只维护一个生成 Prompt 和一个紧凑响应 Schema；Provider 一边接收 reasoning/content SSE，一边把完整闭合的顶层字段组交给 Zod 和语义校验。页面得到早期、安全的业务反馈，但模型只做一次正常生成。

### 推理字段差异

固定预设只在 OpenAI 兼容 Provider 边界做窄映射：

- 小米 MiMo：请求 `thinking: { type: "enabled" }`，使用 `max_completion_tokens`，优先读取 `reasoning_content`；
- 阶跃星辰：请求 `reasoning_format: "general"`，使用 `max_tokens`，优先读取 `reasoning`；
- 高级自定义连接：不注入供应商专属字段，兼容读取标准候选字段。

业务 Flow、Schema、页面和存储均不绑定供应商。

## 运行期与安全契约

`structured-generation-progress.v1` 保留稳定五板块 ID，并新增可选 `thinking`：

- `thinking` 只保留在活动运行内存，按业务 ID 与 single-flight 快照一起重放；
- 首个推理增量立即发送，之后按字符数/短时间窗口合并，避免每个 token 触发 React 重渲染；
- 页面以纯文本显示，生成时自动展开、完成时自动收起，用户可手动切换；
- 推理文本、原始模型响应、私有图片 URI、API Key 和供应商对象不进入正式 DTO、任务文件、报告文件、日志或 Git；
- `raw-response.json` 保持空内容，`reasoning.jsonl` 保持空文件，仅保留兼容文件形状；
- 完整顶层字段组通过校验前，不进入五个正式展示板块。

## 已完成提交

| 提交 | 内容 |
| --- | --- |
| `fc359a0` | 当前单次流式深度思考设计 |
| `bcafa6b` | 当前实施计划 |
| `362228e` | 系统媒体选择器返回时保留活动 WebView 与任务 |
| `a47a3fe` | 小米/阶跃推理协议、单次生成、字段级安全投影与非持久化 |
| `34486b2` | 深度思考界面、五板块反馈、忙碌按钮样式与响应式验收 |

## 已完成验证

截至残余清洗开始前：

- Provider、两条 Flow、字段解析、Runtime replay/single-flight 与非持久化测试通过；完整 `pnpm check` 为 266/266。
- Web 定向测试为 27/27；后续完整 `pnpm check` 为 267/267。
- Web production build 成功，共处理 637 个模块；只有既有的大 chunk 非阻断提示。
- 真实 Chromium 已覆盖桌面和 390px：无横向溢出，深度思考生成时展开、完成时收起，忙碌主按钮保持绿色且文字为黑色。
- reduced-motion 下流光与推理等待动画均为 `none`。
- 浏览器使用无敏感信息的合成推理样例；没有使用或保存用户 API Key。

本地、未跟踪的浏览器证据位于 `output/playwright/single-reasoning-v016/`，不会进入 APK 或 Git。

残余清洗阶段补充验证：

- Flow、Provider、Runtime、存储与 Web 定向回归 52/52 通过。
- 全量 typecheck 与 ESLint 通过；全量测试运行到 267 项时有 266 项通过，唯一失败是 CHANGELOG 未写出“源码在版本推进前暂仍为 code 13”的过渡事实。补全文案后，版本谱系、存储与 Web 定向回归 14/14 通过；完整全量复跑留在 code 14 版本阶段统一执行。
- Web production build 再次成功，共处理 637 个模块；只有既有的大 chunk 非阻断提示。
- `git diff --check` 没有空白错误；341 个当前源代码/文档文本文件通过严格 UTF-8 与 U+FFFD 扫描，API Key 形态扫描未发现命中。

code 14 版本阶段补充验证：

- 先把三个版本谱系测试更新为 code 14，旧实现按预期产生 4 个失败；Android `versionCode`、Release 脚本硬校验和文档推进后，版本定向测试 21/21 通过。
- 完整 `pnpm check` 通过：typecheck、ESLint 与 267/267 测试全部成功；其中包括 Windows 原生 HEIF 构建门禁、Release 签名入口防护、媒体选择生命周期、Provider 推理字段、单次 AI Flow、Runtime 和 Web 回归。
- 受限沙箱中的第一次全量尝试因 Java `user.home` 指向无 Gradle 分发的隔离目录，并被禁止联网下载而在 Wrapper 层失败；使用本机既有 Gradle/JDK 缓存重跑后全部通过。该环境失败没有进入项目断言，也没有通过修改测试或放宽安全门禁规避。

## code 14 已签名候选 APK

| 项目 | 结果 |
| --- | --- |
| 精确来源提交 | `c496a5d79583415de43b50ffa286787b63e7872d` |
| 固定交付文件 | `android/app/build/outputs/apk/release/HongTai-AI-Agent-release-v0.1.6.apk`（Git 忽略，不提交） |
| 包身份 | `com.hongtai.aiagent`，`versionName=0.1.6`，`versionCode=14` |
| 字节数 | 25,955,765 |
| APK SHA-256 | `6575FA8C8AE14D557959233D9BE3A62B903A276B234D646B126C1D911093BEFE` |
| 签名 | non-debuggable；v1=false、v2=true、v3=true；DN 为 `CN=HongTai AI Agent Release, O=HongTai AI Agent, C=CN` |
| 证书 SHA-256 | `54DF122CD4F99720C613737815385E771BFAEB17715C160AED178062AB5B2FDE`，与仓库公开锚点一致 |
| ABI | `arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64` |
| 权限 | INTERNET、ACCESS_NETWORK_STATE、WAKE_LOCK 和 Android 自动生成的非导出 receiver 权限；无相机、相册或存储危险权限 |

仓库 Release 入口重新执行 Web build、Capacitor sync、`:app:testReleaseUnitTest`、`:app:lintRelease`、四 ABI native build 和 `:app:assembleRelease`；148 个 Gradle 任务成功。Gradle 原始 `app-release.apk` 与固定交付名副本的字节数和 SHA-256 完全一致。既有 Vite 大 chunk、Capacitor `flatDir` 和 SDK XML 兼容提示仍为非阻断警告。

## API 35 模拟器证据

- 设备为 `SciChatApi35`：Android 15 / API 35 / x86_64，model `sdk_gphone64_x86_64`，`ro.kernel.qemu=1`，明确不是物理设备；以 `-read-only -no-window -no-snapshot-save` 启动，结束后已关机且未写回 Debug 测试状态。
- 覆盖前为同一 Release 证书的 v0.1.6/code13，`firstInstallTime=2026-08-12 12:14:26`。执行 `adb install -r` 安装 code14，未卸载、未清数据、未使用 `-d`；安装后 `firstInstallTime` 保持。
- code14 冷启动为 `Status: ok`、`LaunchState: COLD`、`TotalTime: 1246 ms`，`MainActivity` resumed，当前应用 PID 日志中 0 条 fatal。首页截图目视确认不是白屏，中文、品牌、拆解入口与底部导航正常。
- 在分享输入框写入只存在于 React 内存的 `PICKER_STATE_814`，再打开真实 `com.android.documentsui.picker.PickActivity` 并取消。返回前后应用 PID 均为 11095，回到同一 `MainActivity`，内存标记仍在，页面明确显示 `MEDIA_SELECTION_CANCELLED`，证明正常系统选择器返回没有重载 WebView。
- Debug、Android test APK 与 lint/JVM 通过 169 个 Gradle 任务构建。只读覆盖层内运行 `AndroidJUnitRunner` 得到 `OK (7 tests)`：5 项实际成功，2 项因仅适用于 API 24/25 HEIF fallback 而按设计跳过；Media3 确定性渲染通过，完整 instrumentation 后 0 条 fatal。
- 本地、未跟踪的模拟器证据位于 `output/android-v016-code14/`。冷启动图为 455,163 字节、SHA-256 `05E6046F07E485B7F2534A4DD4F26CCFD8DF85293E75C19B8F76A1FDF361AE0B`；选择器返回图为 478,593 字节、SHA-256 `574F185661D73E17CC95C94B80C14929A3AE0A321E6E1ED84EA3069939AFFCE2`。

检查 ADB 时没有连接任何物理设备。本节所有升级、选择器、冷启动和 instrumentation 结论都只属于模拟器，不能表述成真机通过。

## 仍需完成的发布门禁

1. 已清除旧五调用 Prompt 文件与过时活文档，并完成定向测试、完整 `pnpm check`、Web build、UTF-8/U+FFFD 和 diff 检查。
2. 已将修复源码候选推进到 `versionName=0.1.6`、新的 `versionCode=14`；code 13 永不复用。
3. 已从精确来源提交重新构建 Release，并独立验证包名、版本、zipalign、v2/v3 签名、证书、ABI、权限、字节数和 SHA-256。
4. 已重新执行 API 35 普通覆盖升级、冷启动、系统视频选择器取消返回和 instrumentation 回归。
5. 在物理设备上验证 v0.1.5 正常覆盖升级、真实视频选择/导入、舌象/面部观察、内容拆解、深度思考显示与前后台行为。
6. 真机通过后才允许人工上传、公网哈希回验、下载页切换、合并 `main` 和推送；当前公开推荐继续为 v0.1.5/code12。

主机、浏览器、构建或模拟器成功都不能替代第 5 步，也不能单独称为正式发布。
