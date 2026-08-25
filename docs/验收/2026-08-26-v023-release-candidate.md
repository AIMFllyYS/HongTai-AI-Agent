# v0.1.23 Release 验收记录（主机门禁与公开文件回验通过）

## 结论

本轮针对代码清洗后的未验证状态完成了多角色审查、代码级边界测试、Web 浏览器端到端测试和 Android Release 构建。源码已推进到 `versionName=0.1.23` / `versionCode=31`，Release APK 已正式签名、独立归档并完成公网文件回验。

`v0.1.23` 已上传到固定公网地址，重新下载后与本地归档逐字节一致，仓库 `download.html` 已切换为当前推荐版本。公开分发只证明文件身份和下载链路已回验，不代表物理真机、真实 Provider 或最终成片全链路已经验收通过。

## APK 身份与文件

| 项目 | 本次事实 |
| --- | --- |
| 包名 | `com.hongtai.aiagent` |
| versionName | `0.1.23` |
| versionCode | `31` |
| 归档文件 | `output/apk-archive/HongTai-AI-Agent-release-v0.1.23.apk` |
| 文件大小 | `23,330,385` bytes |
| SHA-256 | `b63e9ab4135d6e4a1ebcb4543e906dc0119e59c7e7e75d61e07a547fab5d8315` |
| 签名身份 | `CN=HongTai AI Agent Release, O=HongTai AI Agent, C=CN` |
| 证书 SHA-256 | `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde` |
| 公网地址 | `https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.23.apk` |
| 公开推荐版本 | 已更新为 `v0.1.23` / `versionCode=31`，公网文件与本地归档逐字节一致 |

归档由唯一入口 `scripts/build-android-release.ps1` 生成。脚本拒绝覆盖同版本不同字节的旧归档；`v0.1.22` 原归档保持不变。公开文件使用固定版本化地址，不覆盖历史 APK。

## 本轮审查与修复

### 安全边界

- AI 共享 SSE、非流式 Fetch、Capacitor 原生队列、Android 原生 AI 流和浏览器开发态 AI 流均有 2 MiB 响应/积压上限；超限返回稳定可重试错误。
- 浏览器开发态 API Key 只保留在进程内存，不再写入 `.tmp/hongtai-browser-io/secrets.json`；AI 重定向逐跳校验 HTTPS、同源和最多 3 跳，并拒绝私网及 IPv4-mapped IPv6 字面量。
- 浏览器开发态媒体下载、二进制导入、状态保存、文本替换和 URI 复制先写临时文件再原子替换；Node 页面正文和媒体下载同样有大小上限，并拒绝本机/私网 HTTPS 字面量目标。
- Release APK 归档脚本对源 APK、归档目录和归档文件检查 Windows reparse point，避免归档路径越界或误写外部目标。
- 本地图片观察 harness 移除 `innerHTML` / `insertAdjacentHTML`，用户文本和模型文本使用 `textContent` 与显式 DOM 节点；图片声明 MIME 与魔数不一致时在 Sharp 解码前拒绝。

### 数据与业务稳定性

- 本地任务只持久化可重放的公开 URL 参数；B 站保留 `aid` / `p`，跟踪、会话、签名参数和 fragment 不再进入任务快照或请求文件。
- 诊察追问不再把未经医疗边界 Schema 校验的 Provider 增量直接交给页面；只在合规回复保存成功后一次性发布。
- 任务、观察、微调和复刻详情页统一关闭底部主导航，避免 detail 路由重复挂载 portal 导航或保留错误底部 padding。
- 更新日志页增加官方站点 `no-cors` 连通性探测；离线网络导致 iframe 伪 `onLoad` 时仍进入「官方更新页暂时打不开 / 重新加载」恢复态。

## 验证证据

### TypeScript、Node、共享运行时

- `pnpm check`：根测试 `552/552` 通过，`@hongtai/capacitor-runtime` 测试 `127/127` 通过；workspace typecheck 和 ESLint 通过。
- 定向安全/版本测试：31 项 Node/归档/浏览器测试通过；版本与 Android 边界测试 36 项通过。
- `pnpm audit --prod`：无已知生产依赖漏洞（既有审查结果，本轮未改变依赖版本）。

### Web 构建与端到端

- `pnpm --filter @hongtai/web build`：Vite production build 通过。
- Web smoke/e2e 覆盖桌面约 `1280×900` 与移动约 `390×844`：首页、三种新建入口、观察页面部/舌象切换、模板搜索、设置、任务错误态和 canonical 路由均通过；无控制台错误、无稳定失败请求、未授权 RPC/文件请求返回 403。
- 更新日志专测覆盖在线 iframe 成功和离线请求 abort 两路：在线显示 iframe，离线显示错误标题和「重新加载」，不保留空 iframe。
- 生产包仍有一个约 `793 KiB` 的主 chunk，Vite 给出超过 `500 KiB` 的性能提示；不影响本次功能/安全门禁，后续可单独做拆包优化。

### Android Release

- `scripts/build-android-release.ps1`：Web build、Capacitor sync、Release JVM 单测、`lintRelease`、四 ABI CMake/native 构建、`assembleRelease`、16 KiB zipalign、包身份、版本、证书锚点和 SHA-256 后验全部通过。
- Gradle `testReleaseUnitTest`：`137` tests，`0` failures，`0` errors。
- `lintRelease`：`0` errors，`28` warnings；Gradle 的 `flatDir` 和 SDK XML 版本提示属于已有工具链警告，未被当作通过错误隐藏。
- `aapt2 dump badging` 确认包名 `com.hongtai.aiagent`、`versionCode=31`、`versionName=0.1.23`；`apksigner verify` 确认 v2/v3 均为 `true`，签名不是 Android Debug；`zipalign -c -P 16 -v 4` 验证成功。

## 未宣称的边界

- 没有物理 Android 手机、OEM WebView、真实外部 Activity 长任务和真实 Provider 网络的本轮证据；不能把本版本称为真机通过或真实模型全链路通过。
- B 站 APK 真网下载仍按 [#122](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/122) 保留，浏览器/主机模拟响应不替代 APK 真网复验。
- 模拟器 Media3、Agent 真实 `generatePlan`、硬件编码器失败回退和真实用户素材仍按既有验收文档的边界说明。
- `download.html` 已切换为 `v0.1.23`，公网 APK 已重新下载核对大小/SHA-256；随后读取 `https://husteread.com/HongTai/download.html`，在线页面当前也返回 v0.1.23、code31、同一 SHA-256 和 v0.1.22 历史卡。
- 本地 workspace 中原有的 `.gitignore` 修改以及 `shot-start.png`、`start-screen.png` 未纳入本轮提交。
