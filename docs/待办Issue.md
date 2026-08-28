# 待办 Issue 同步

> 同步日期：2026-08-26。GitHub open / 关单状态仍沿用最近一次人工同步；本轮额外记录了代码审查后已落地、但未由本任务代关闭的 Issue 实现。
>
> 本文**不是**能力声明。当前能做什么仍以 [当前能力与发布状态](当前能力与发布状态.md) 为准。GitHub 当前队列是 **open 且无 `future`**。
>
> 权威 Issue：https://github.com/AIMFllyYS/HongTai-AI-Agent/issues

**先看第一节。** 那是还没收尾的 P0 和半成品 bug。后面的 P1 / P2 / 未来方向只作索引。

---

## 一、没收尾（放最前）

清洗后，**当前队列只剩 2 条 open、无 `future`**：[#122](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/122)（P0 采集）和 [#94](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/94)（页面层 1:1，正在做，不是旧 bug）。

真正「代码改过、验收没关上、用户路径仍可能失败」的，是 #122。#87 / #86 已关，但尾巴分别落在 #122 和「真机 / 硬件回退未触发」。#7 与 #8 的本轮代码缺口已经补上，但 GitHub 状态和维护者验收没有被本任务代替。另有一批关单后没单独开票的孤儿残留。

### 1. P0 还开着：[#122](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/122) B 站解析成功后下载立即失败

**状态：** open，`bug` + `priority: P0`。这是目前唯一的 P0。

**用户看见什么：** 链接爆款拆解里，同一安装、同一网络下小红书和抖音还能走通，B 站公开单视频过不了采集。任务倒在 `download-media`，不是倒在解析。

**为什么只有 B 站炸：** 四个适配器里，只有 B 站走「视频流 + 独立音频流再合并」。管线有 `audios` 就先下 `video-source.bin` 再下 `audio-source.bin` 再 merge；抖音、小红书的 `audios` 是空的，只下一份视频。

**根因（Issue 正文，2026-08-19）：** APK 原生下载在写私有文件前检查 Content-Type。旧规则是 `kind=audio` 只接受 `audio/*` 或 `application/octet-stream`。B 站 CDN 对这段 AAC-in-MP4 声明的是 `video/mp4`，原生层立刻 `MEDIA_DOWNLOAD_FAILED`（「The audio source returned an unexpected media type.」）。

浏览器 Vite 下载**不按槽位校验 MIME**，CLI 也只拒绝视频槽上的 HTML/JSON/HLS。所以 2026-08-18 浏览器跑通**不能**当成 APK 下载已通过。

**主机真网探测（不是 APK/真机证据，正文记录）：** 同一条公开稿 `BV1bybQ6KEQP`（54 秒），无 Cookie：

| 步骤 | 结果 |
| --- | --- |
| `resolve` / `parse` | 成功：标题、UP 主、时长 54s、4 路视频 + 3 路音频 |
| `playurl` | `code=0`，DASH |
| 选中的视频 | `avc1`，带 Referer 时 CDN HTTP 206；不带 Referer 时 CDN 403 + `text/html` |
| 选中的音频 | 解析字段 `audio/mp4`，CDN 实际声明 **`Content-Type: video/mp4`**，带 Referer 时 HTTP 206 |

**界面诊断缺口（正文仍成立）：** Android 下载拒绝码没有 `ERR_` 前缀，`issueFromError` 只从 `ERR_*` 抽 `details.nativeCode`。用户往往只看到阶段 `download-media`、一句「媒体下载失败」，分不清是 403、HTML，还是音频槽 MIME 被误杀。

**代码已经改了什么：** `DownloadMediaTypePolicy` 现在音频槽接受 `audio/*`、`application/octet-stream`，以及 ISO BMFF 的 `video/mp4`；仍拒绝 `text/*`、JSON、HLS。JVM 单测已锁。

**2026-08-19 评论（不代关闭）：**

> 代码已按 DASH 音频常见声明落地（不代关闭）。
>
> `DownloadMediaTypePolicy`：音频槽接受 `audio/*`、`application/octet-stream` 和 ISO BMFF 的 `video/mp4`；仍拒绝 `text/*`、JSON、HLS。JVM 单测已锁。APK 真网单视频下载未在 WebView 里复现（模拟器填不进链接）。

**为什么还不能关：** 验收第一条就是「APK 上用公开 B 站单视频复现，记下终态 `stage` 与 `issues[0].code`」。模拟器 `adb input` 写不进 Capacitor WebView，没有 APK 真网记录。2026-08-20 用户端测失败时登记的就是这条；代码改在那次端测的定位之后，**改完后再没在 APK 上复验**。

**关单前还要满足（摘自验收，未勾）：**

- 无 Cookie 的公开短稿能过 `download-media` 并留下可探测的本地音视频；或 CDN/风控拒绝时给出已登记业务码，不再被 `video/mp4` 音频声明误杀
- 抖音、小红书对照路径仍成功
- HTML / JSON / HLS 仍不能写成任务私有媒体
- 不得把浏览器 Vite 或主机探测写成真机通过

**不要做的事：** 不要并回 #87 去改 `view` / `playurl`；不要引入 Cookie / buvid；不要取消对 HTML、JSON、HLS 的拒绝。

**2026-08-28 追加（CLI 层第二根因，已修复并实跑验证）：**

> 排查用户短链 `https://b23.tv/QuHScxo` 时发现 CLI 采集链路另有独立回归，与 APK 音频槽 MIME 无关：`b8a0ce4`（2026-08-17）把 `FfmpegMediaTools` 的输出改为 `.part` 临时文件原子写入后，ffmpeg 无法从 `.part` 扩展名推断输出格式，`merge` 与 `extractAudio` 双双失败（`MEDIA_MERGE_FAILED`）。这是「一个月前 CLI 好使、后来坏了」的直接原因；测试用 fake spawn 不执行真 ffmpeg，故从未拦截。
>
> 修复：`merge` 两处调用显式 `-f mp4`、`extractAudio` 显式 `-f wav`，新增回归测试锁定格式声明。验证：定向测试 28/28、`pnpm check` 全过；CLI 实跑该短链全链路成功（任务 `20260828093945-5yy4f7`：解析→双流下载→合并→34s 时长校验→转写 2 分段 214 字→`succeeded`/`transcribed`），产物 `video.mp4` 经 ffprobe 确认 h264+aac 双轨。
>
> 本段只收窄 #122 的排查面（CLI 已通、浏览器已通、APK 源码已含 MIME 修复）；**APK 真网复验条件不变**，见上文关单清单。Android 端 remux 逐项核对（显式 `MUXER_OUTPUT_MPEG_4`、编码白名单覆盖 `video/avc`+`audio/mp4a-latm`、时序约束满足）未发现新缺陷，不改原生代码。

---

### 2. 已关、但采集尾巴就是 #122：[#87](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/87) B 站 APK 一律解析失败

**状态：** 2026-08-21 清洗关闭。解析侧独特工作已落地；下载侧交给 #122。

**原问题：** APK 里 B 站链接一律采集不到。正文定位过：`resolve()` 先抓整页 HTML（Android 2MB 上限），而 `parse()` 根本不读这份 HTML；`playurl` 要偏登录态的高清晰度、没有 wbi；`-352` 风控未映射。

**2026-08-18 维护者判定（当时未关）：**

> - **状态**：部分修复，未完成。
> - **已发生的事实**：`v0.1.14` 已合入主机侧改动（解析不再依赖整页 HTML，B 站 `-352` 映射为风控）。
> - **仍未成立的事实**：真实端到端仍未跑通，整条电路不通。
> - **端测口径**：因本项目采集走共享 Flow，真实端测在浏览器完成即可，不把物理机当作本条关闭条件。

**2026-08-20 用户端测评论：**

> 链接爆款拆解里小红书仍可解析、抖音也正常，B 站公开单视频仍然过不了。
>
> 复查当前源码后，#87 正文里的解析主因（整页 HTML 超 2MB、未签名 playurl、`-352` 未映射）已经不在当前适配器路径上。主机用同一公开稿 `BV1bybQ6KEQP` 可以 `parse` 成功并带 Referer 从 CDN 取到 DASH 流。
>
> APK 上新的阻断登记为 #122：B 站走独立音频槽，CDN 把 AAC-in-MP4 声明成 `Content-Type: video/mp4`，`NativeDownloadClient` 对 `kind=audio` 会在写盘前立即 `MEDIA_DOWNLOAD_FAILED`。浏览器 Vite 同一条路径没有这道检查，所以 2026-08-18 的浏览器跑通不能当作 APK 下载已通过。
>
> 本 issue 仍可按原验收等 APK 上的解析/风控记录；下载阶段请跟 #122，不要在这里继续改 `view`/`playurl` 当唯一修复。

**2026-08-19 批次 11 评论：** 解析侧仍是 wbi / `PUBLIC_QN=64` / 不拉整页 HTML。模拟器装了签名 Release，但 `adb input` 进不了 WebView，**没有** APK 真网解析成功或风控码的新证据。

**2026-08-21 关单：** 解析不再拉整页 HTML；公开档 playurl / wbi；`-352` → `PLATFORM_RISK_CONTROLLED`。下载剩余见 #122。

**残留：** APK 上「B 站整条采集电路」仍没收尾，票在 #122，不在已关的 #87。

---

### 3. 已关、合成分类做完、真机没关上：[#86](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/86)

**状态：** 2026-08-21 清洗关闭。独特工作（失败码可区分 + 软件 H.264 回退 + `generatePlan` 测试）已落地。

**原问题：** 真机点「本地合成视频」后，一律弹出「手机未能完成 H.264/AAC 视频导出。请更换兼容的 MP4 素材后重试。」这是 `MEDIA_EXPORT_FAILED` 的唯一兜底，覆盖编码器失败、OpenGL/EGL、MIME 被 fallback 改写、成片校验不通过、临时文件为空。没有重试按钮，项目卡上看不到原因。

**2026-08-18 维护者判定（当时未关）：**

> 导出失败分类的代码已落地，但「AI 生成制作计划」整条链路在浏览器端测中不通，缺少测试。本条保持打开，不能标完成。
>
> - `v0.1.14` 已拆分导出失败码，并允许硬件编码器失败后回退软件 H.264。
> - 当时端测：AI 生成制作计划整段不通，缺测试。
> - 端测口径：制作走共享 Flow，真实端测在浏览器完成即可，不把物理机当作本条关闭条件。

**2026-08-19 模拟器评论（不代关闭，不是物理真机）：**

> API 35 签名 Release instrumentation 用无容器的假 MP4 触发 `ProductionException`，`kind=MEDIA_EXPORT_FAILED`，走已登记导出失败码，不是无码合并失败。成功路径的 v3/数字人成片见 `docs/验收/2026-08-20-batch11-media3.md`。硬件编码器不可用回退本次未触发（模拟器软件路径直接成功）。

**2026-08-21 关单：** 失败码已拆分；软件 H.264 回退代码在；`generatePlan` 有测试。剩余写成「项目级真机未验，不阻塞关单」。

**残留（没有单独 Issue）：**

- 物理真机成功合成仍未验。#86 原文验收要求「同一台真机上完成一次成功合成」。
- 硬件编码器失败后的软件回退，模拟器从未触发。
- Agent 真实 `generatePlan`（真模型，不是 instrumentation 喂计划）仍未验。批次 11 父项评论写明「不是：物理真机通过；Agent 真实 `generatePlan`；B 站 APK WebView 真网采集」。

---

### 4. 代码修复已补、Issue 尚未代关闭：[#7](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/7) sharp 升级并限制危险解码器

**状态：** 仍 open，`priority: P1` + `future`；本候选已落地代码修复和边界测试，未代 Issue 关闭。

**前半句（已完成）：** `sharp` 升到精确 `0.35.3`，`pnpm audit --prod` 不再报那条 CVE。证据在 `docs/验收/2026-08-10-cli-sharp-security.md`。

**后半句（本候选已做）：** `SharpImagePreprocessor` 在 `sharp()` 前检查 JPEG、PNG、WebP 魔数，声明为 JPEG 的 GIF/TIFF 和 MIME/文件不一致输入稳定返回 `IMAGE_INVALID`；对应测试已通过。2026-08-16 的旧复核评论记录的是修复前状态：

> `sharp-image-preprocessor.ts:18-32` 仍然先按声明的 MIME 判断，再把字节直接交给 `sharp()`，仓库内没有 `sharp.block()` 也没有魔数预检。伪装成 `image/jpeg` 的 GIF 或 TIFF 仍会进入解码器。
>
> 影响范围限于开发期 CLI，不进 APK。

**维护边界：** 代码已在本候选落地，仍需 Issue 维护者确认是否关闭；影响范围限于开发期 CLI，不进 APK。

---

### 5. 本候选已落地但尚未代关闭：[#8](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/8) 诊察 harness 安全 DOM

**状态：** GitHub 仍按最近一次同步保留为 open + `future`；本轮已移除 `innerHTML` / `insertAdjacentHTML`，改为 `textContent` 和显式节点组装，并通过源代码边界测试。没有把测试 harness 的修复写成 APK 产品能力，也没有代维护者关闭 Issue。

---

### 6. 关单后没有单独 Issue 的孤儿残留

这些在旧状态文档或关单评论里写过，**看板不会提醒**：

| 残留 | 从哪来 | 现状 |
| --- | --- | --- |
| Agent 真实 `generatePlan` | 批次 11 / #86 评论 | 浏览器/测试锁过规划路径；模拟器成片是 instrumentation 喂计划。物理机用真实模型跑通制作主链没有专属票 |
| 物理真机全链路 | #1–#6、#86、#106、#113 按代码+模拟器关了 | 真机触控、OEM WebView、真机 Media3 成片仍是发布边界 |
| 硬件 H.264 回退未触发 | #86 | 代码有，模拟器软件路径直接成功 |
| 装饰不挡字幕 | #113 | 没有像素碰撞校验 |
| `floating_text` 渲染器在、没有生产者 | 关 #113 时写下 | 计划层没有人写出这种装饰 |
| 口播表情符号切句 | 批次 10 状态原文 | 按码位切句、Zod 按 UTF-16 计长，失败提示会说成「字幕生成不出来」。fail-closed，不写坏项目，但提示不准确 |

---

## 二、当前还在做、但不是没收尾的 bug

### [#94](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/94) 整体前端重新设计

open，无 `future`。当前分支 `feat/hongtai-mobile-ui-redesign` 就是这条。权威稿是 `docs/Hong/新设计/hongtai-mobile.pen` 的**未归档**画板，不是 Issue 标题里的 `global.pen`（2026-08-21 已在评论更正）。只改 `apps/web` 呈现，不改 `updatePlan` / replica 契约。

---

## 三、P1 / P2 以及未来要做的（一带而过）

这些都带 `future`（#94 除外）。问题仍在，本轮不排期。要动手时以 GitHub 正文为准，2026-08-08 的「最小修复范围」可能过时。

### 字幕与制作下一层（P2，`future`）

| # | 一句话 | 要更新什么 |
| --- | --- | --- |
| [115](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/115) | 旁白 TTS 实际时长没回流 | 合成器现在返回的是计划时长。字幕出入点只有 `script_estimate`（按字数铺满镜头） |
| [116](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/116) | 转写只返回纯文本 | 数字人要词级时间得有 `asr_word` 生产者；现在没有 |
| [118](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/118) | 计划并发写入要文件层原子交换 | `expectedUpdatedAt` 只能缩小 TOCTOU，两个运行时实例仍不安全 |
| [120](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/120) | 清单要的 vs 画面有的 | #112 只保证素材被看过一次；绑错文件不会被拦 |

### 产品方向（P2/P3，`future`）

| # | 一句话 | 要更新什么 |
| --- | --- | --- |
| [121](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/121) | 舌象/面部五行全身参考 | 观察 Schema + 报告页；禁止做成健康评分或确诊 |
| [97](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/97) | 数字人对标剪映 | 一键剪口播、字幕/转写/基础轨道，不是当前页面层 1:1 |
| [128](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/128) | Capacitor 停在 8.0.0 | #101 键盘 inset 已关；写死 24px 底栏兜底、手势/三键留白不一致留在这里 |

### 2026-08-16 转 future、实现状态按本候选复核

| # | 优先级 | 要更新什么 |
| --- | --- | --- |
| [7](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/7) | P1 | 本候选已完成魔数预检；待维护者更新 Issue 状态 |
| [8](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/8) | P1 | 本候选已完成安全 DOM；待维护者更新 Issue 状态 |
| [15](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/15) | P1 | 已知抖音/小红书 ID 时只接受精确目标媒体 |
| [16](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/16) | P2 | Node 下载补私网地址和重定向防护 |
| [17](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/17) | P2 | 跨桥接「非空文件」校验契约对齐 |
| [18](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/18) | P2 | 诊察成功重试后清掉历史失败 issue |
| [19](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/19) | P2 | 本地视频容量预算、空间检查、可恢复删除 |
| [21](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/21) | P2 | 小屏错误通知遮挡标题和控制项 |
| [23](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/23) | P2 | 质量门禁自动化成与规范一致的 CI |
| [24](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/24) | P3 | 不可达 legacy 视觉 fixture 移出生产 bundle |
| [25](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/25) | P3 | 合并重复的 Android 私有文件策略，去掉陈旧 TaskStateSnapshot |
| [26](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/26) | P3 | 统一 core / Node / Capacitor 的 taskId 校验 |
| [27](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/27) | P3 | Capacitor 复用 core 的转录摘要规则 |
| [28](https://github.com/AIMFllyYS/HongTai-AI-Agent/issues/28) | P3 | 为渲染生成的视频定义 `generated` 来源元数据 |

#20（仅导入/渲染常亮）已在清洗时关闭，不要再当 future。

---

## 四、看板怎么读

| 过滤 | 含义 | 现在有哪些 |
| --- | --- | --- |
| open 且无 `future` | 当前队列 | **#122**、**#94** |
| open + `future` | 以后再做 | #7 #8 #15–#19 #21 #23–#28 #97 #115 #116 #118 #120 #121 #128 |
| 已关、尾巴另挂 | 本条做完 | #87 → #122；#107 → #115/#116；#109/#108 → #118；#111/#112 → #120；#101 → #128 |

批次 8–11 父项（#85 #98 #103 #123）已关。不要把已关 Issue 重新打开，除非独特工作又坏了。
