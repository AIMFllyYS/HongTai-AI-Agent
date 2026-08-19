# v0.1.17 制作双模式 Release 验收记录（公网已发布，真机待验）

## 目标与范围

- 用户可感知结果：提供包含批次 10 制作双模式、字幕模板、随包贴纸、素材观察、爆款复刻向导和导出微调的正式签名 Android Release 候选。
- 架构归属：Web UI、共享 core/ai Flow、Capacitor 组合层与 Android Media3 I/O。
- 明确不做：不补 ASR 逐字时间，不把按字数估算说成音频对齐，不新增发布功能，不声称物理真机已经通过。

## 候选身份

| 项目 | 结果 |
| --- | --- |
| applicationId | `com.hongtai.aiagent` |
| versionName | `0.1.17` |
| versionCode | `25` |
| 文件名 | `HongTai-AI-Agent-release-v0.1.17.apk` |
| 文件大小 | `21,932,117` bytes |
| APK SHA-256 | `1358dfa5d16fb6c4f25c2684e4a23b3773296167fe51069ce5b466a1a9212b53` |
| 证书 SHA-256 | `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde` |
| 签名主体 | `CN=HongTai AI Agent Release, O=HongTai AI Agent, C=CN` |

## 主机验证

- `pnpm check`：构建前基线通过，根测试 497/497，`@hongtai/capacitor-runtime` 117/117。
- 复刻向导文案定向测试：12/12 通过。
- `pnpm --filter @hongtai/web build`：通过，706 modules transformed。
- Release 构建脚本：通过。
- Gradle `:app:testReleaseUnitTest`：通过。
- Gradle `:app:lintRelease`：通过。
- Gradle `:app:assembleRelease`：通过，四 ABI。
- 16 KiB zipalign、包身份、版本、v2/v3 正式签名、证书锚点和 APK SHA-256 后验：通过。
- `git diff --check` 与 UTF-8 替换字符扫描：通过。
- 发布文档完成后的完整 `pnpm check`：通过，根测试 497/497，`@hongtai/capacitor-runtime` 117/117。

## 真实性边界

- 当前只有 `script_estimate` 字幕时间层：字幕按字符权重铺时间，不是对着实际人声测量。
- `karaoke_glow` 在缺少词级时间时降级为 `classic_line`，界面保留并说明原选择。
- 爆款复刻向导只生成清单、绑定素材、生成计划并进入微调；最终成片仍需回制作页调用 Android 本地合成。
- 素材观察表示画面帧被送入视觉模型一次，不保证模型描述正确，也不机器核对“清单要的”与“画面有的”。
- 主机测试和 Release 构建不等于物理设备、真实 Provider、真实 TTS 或 Media3 成片已经通过。

## 物理设备待验

1. 从公开 `v0.1.16` 升级到公开 `v0.1.17`，使用同证书普通覆盖安装，不卸载且不使用降级参数。
2. Agent 素材剪辑：至少 3 个真实素材，生成 v3 计划、微调、TTS、字幕、贴纸并输出一条 720×1280 H.264/AAC MP4。
3. 爆款复刻：生成清单、逐项绑定、进入微调、回制作页并输出一条 MP4。
4. 数字人口播：一条带原声 MP4 与一致口播稿，确认保留原声、不叠 TTS/BGM并烧录字幕。
5. 修改口播、主文字或模板后确认旧成片失效，重新合成的 MP4 反映修改。
6. 记录设备型号、Android/API、安装结果、APK SHA-256、成片规格和失败错误码。

## 当前发布状态

本文件记录的 `v0.1.17` 已完成固定公网地址上传，并从公网重新下载核对得到与本地归档一致的 21,932,117 字节和 SHA-256 `1358dfa5d16fb6c4f25c2684e4a23b3773296167fe51069ce5b466a1a9212b53`；`download.html` 现推荐公开的 `v0.1.17`。公开分发只证明文件身份和下载链路已回验，不等于物理 Android 真机、真实 AI Provider 或两条制作主链已经验收通过。
