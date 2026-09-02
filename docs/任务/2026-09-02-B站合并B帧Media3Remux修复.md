# 2026-09-02 B 站合并 B 帧 Media3 Remux 修复

> 按 [任务执行模板](../任务执行模板.md) 写成的单次任务契约。任务完成后转为历史记录，不是当前能力声明。
> 前序：[2026-09-01 B 站解析 WBI 签名修复](2026-09-01-B站解析WBI签名修复.md)（解析层）；本任务修合并层。

## 目标

- 用户可感知的结果：APK 端 B 站公开链接从「解析成功但合并失败（界面仅显示媒体下载失败）」变为七阶段全链路完成、合并产物可在应用内播放。测试链 `https://b23.tv/dRtdz4d`。

## 允许修改

- `android/app/src/main/java/com/hongtai/aiagent/media/AndroidMediaRuntime.kt`：remux 换 Media3 Mp4Muxer、轨道时间戳重基、音轨 sync flag、校验消息带比对值。
- `android/app/build.gradle.kts`：新增 `androidx.media3:media3-muxer:1.10.1`（与既有 media3 模块同版本）；`versionCode` 43→44、`versionName` 0.1.35→0.1.36。
- `android/app/src/androidTest/java/com/hongtai/aiagent/media/TaskRemuxBFrameInstrumentationTest.kt` 与合成夹具 `bframes-video.mp4` / `bframes-audio.m4a`（testsrc2/sine 合成，无版权内容）；删除一次性诊断 `BilibiliRemuxDiagnosticTest.kt` 及真实 B 站夹具。
- `docs/当前能力与发布状态.md`、`docs/待办Issue.md`、`docs/文档索引.md`、本文件。

## 明确不做

- 不改 `packages/*` 共享 TS（解析层修复已随 v0.1.35 在包内，本次零改动）。
- 不转码、不重采样；remux 仍是纯封装层拷贝，样本负载逐字节保留。
- 不新增网络权限、不改 `NativeNetworkPolicy`；不修 UI「媒体下载失败」诊断缺口（已登记 #122 后续）。
- 不把真实 B 站视频留在仓库夹具中（版权），回归一律用合成媒体。

## 架构归属

- 所属层：Android I/O（`android/app` 媒体运行时）。
- 依赖方向：Kotlin 只做媒体封装与校验，不决定业务流程；`TaskMediaRuntimePolicy` 的 codec 白名单（video/avc、video/hevc、audio/mp4a-latm）不变。

## 根因（系统性结论）

1. **B 站视频是 H.264 High 带 B 帧**（实测 `has_b_frames=3`，30fps，1022 样本中 480 处 PTS 回退，decode 序 PTS 形如 `0, 4267, 2133, 1067, 533…` ticks@16000）。`MediaExtractor` 按解码序吐样本，PTS 非单调；旧 remux 的 `pts >= lastPts` 单调性 `require` 直接拒绝。抖音/小红书源无 B 帧，所以只有 B 站炸——这是「手机端 B 站一直不好使」在解析修复之后仍失败的第二根因（logcat `BiliRemuxDiag` 实测异常链确认）。
2. **框架 `MediaMuxer` 不写 ctts box**，无法安全承载 B 帧 → 换 **Media3 `Mp4Muxer`**（排序 PTS 计算 stts 时长并写 ctts；样本按到达序存储，负载不变）。
3. **两个次级时间戳事实**（端测暴露）：AAC 源首样本可为负 PTS（编码器 priming，合成夹具实测 -23.2ms）；Media3 会把轨道最小时间戳重基为 0，回读与写入值错位。两者按统一规则处理：每条轨道先做一次**仅元数据预扫**取最小 PTS，写入时整体重基到 0——轨道内全部 delta 逐样本保留，负时间戳与 muxer 二次重基同时消除。真实 B 站源 min PTS 本来就为 0，重基为无操作。
4. **音轨 sync flag 表示法差异**：fMP4 源的 trun 不标记 sync（回读 flag=0），而普通 MP4 缺省/全量 stss 回读全 sync——AAC 帧本就全部可独立解码，写入时统一标 `BUFFER_FLAG_KEY_FRAME`，写出与回读的 flag 序列才一致，payload digest 校验才有意义。

## 修复

- `remuxTracks`：预扫 `scanTrackTiming`（min/max PTS、配对闸门口径改为原始 min/max）→ `Mp4Muxer` 写入（`copyEncodedTrack` 按轨道偏移重基，单调性 require 放宽为腐败上界 ±2s）→ `close` 后回读 `requireSummariesMatch`（mime/样本数/payload digest 精确一致，首/峰值 PTS ±1000µs 容差；失败消息带实际/期望比对值）。任一校验失败删除临时产物，不暴露。
- 校验契约随实现更新：`TrackSampleSummary` 时间戳为重基后口径；`TrackSampleDigest` 只哈希 (size, flags)，不含 PTS（muxer 会按自身 timescale 重量化）。

## 验收

- 定向回归（模拟器 hongtai-api35，API 35，release 变体 instrumentation）：`TaskRemuxBFrameInstrumentationTest` 2/2（合成 B 帧视频+AAC 双轨合并后 probe 双轨；纯 B 帧视频无音轨）。
- **真实源验证**：把测试夹具临时替换为端测期从 CDN 拉取的真实 `v.m4s`/`a.m4s`（has_b_frames=3 / 首 PTS 0），同测试类 2/2 通过后立即恢复合成夹具。
- 相邻回归：`PrivateMediaStoreInstrumentationTest` 通过；`:app:testReleaseUnitTest` 通过；`lintRelease` 随构建通过。
- APK：v0.1.36 (versionCode 44) Release 签名构建归档 `output/apk-archive/HongTai-AI-Agent-release-v0.1.36.apk`，SHA-256 `f53d44d9e13a67701cf5d9f74fa822f76dce426353bad0922abe0cdafd8d7142`；升级路径实测：v0.1.35(43) → v0.1.36(44) 普通 `install -r` 成功、`firstInstallTime` 保留；反向 43 over 44 被平台正确拒绝。
- **模拟器全链路端测**（v0.1.36，测试链 `b23.tv/dRtdz4d`，WebView 驱动）：识别平台→解析链接（WBI 签名 view，BV1jCtH6hEk3）→提取内容（标题/作者/4 视频源）→下载媒体→合并→获取文稿→保存产物全部完成；`task.json` 仅剩 `AI_NOT_CONFIGURED` / `AI_EMPTY_RESPONSE` / `TEXT_REWRITE_FAILED` 三条 warning（模拟器未配 ASR/LLM Key，诚实降级为平台字幕文稿），无一条媒体错误。
- 产物取证：拉取 `media/video.mp4`（3,053,386 字节，SHA-256 `e3307ea1…92c690d`），`ffprobe`：h264 `has_b_frames=3` 1022 帧 + aac 1466 帧（与 CDN 源逐样本一致），双轨 `start_time=0.000000`；`ffmpeg -f null` 全程解码零错误，1s/30s 抽帧正常；应用内播放器正常起播。

## 交付说明

- 改了什么：Android 原生 remux 引擎（框架 MediaMuxer → Media3 Mp4Muxer 1.10.1）+ 时间戳重基 + 音轨 sync flag 归一 + 校验消息可诊断化 + 合成 B 帧回归夹具。
- 刻意没有做什么：见「明确不做」；v0.1.35 归档保留不覆盖（只含解析修复），本次以 v0.1.36 交付。
- 剩余风险或新增 Issue：物理真机复验仍建议由用户执行一次（模拟器已全绿）；UI 合并失败诊断缺口（真因被「媒体下载失败」掩盖）仍在 #122 跟踪。
