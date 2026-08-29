# v0.1.26 Release 验收记录（本地打包归档完成，公网切换未开始）

## 结论

制作板块「一键全自动 + 数字人单视频」重定义（任务契约见[制作一键全自动与数字人重定义](../任务/2026-08-29-制作一键全自动与数字人重定义.md)）的源码已按任务周期完成 TypeScript 层实现、运行时边界和测试锁定；随后将 Android 源码推进到 `versionName=0.1.26` / `versionCode=34`，使用仓库外正式签名配置完成 Release 构建、签名后验和独立归档。

本轮只完成本地打包与归档。`v0.1.26` 尚未上传公网，`download.html` 公开推荐仍为 `v0.1.25`；公网上传、下载页切换与回验是下一个独立步骤。主机/模拟器门禁不等于物理手机、真实 Provider 或最终成片全链路通过。

## 版本与文件

| 项目 | 结果 |
| --- | --- |
| applicationId | `com.hongtai.aiagent` |
| versionName | `0.1.26` |
| versionCode | `34` |
| Release APK | `output/apk-archive/HongTai-AI-Agent-release-v0.1.26.apk` |
| APK 大小 | `23,382,674` bytes（本地归档） |
| APK SHA-256 | `1b01fd2a2708da3d4c7da9afdcb4f27e85dbcbc3c8f8e1ba0148945576fd8e11` |
| 证书 SHA-256 | `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`（与历史发布一致） |
| 公开推荐 | 仍为 `v0.1.25` / code33（`download.html` 未切换） |

## 一键全自动管线的端侧保证链路

### 1. 三入口默认一键

- 智能成片、爆款复刻、数字人创建项目后默认进入「一键制作成片」：`runAutomaticPipeline` 把分镜脚本 → 逐句配音 → 组装 → 渲染串成单一管线自动推进；分步方法保留为编辑逃生口。
- 一键期间管线失败落盘 `project.issue`，界面明确展示原因；不伪造成功、不永久“进行中”。

### 2. 数字人 = 一段预处理视频

- 新 avatar 项目不再要求逐字稿；`planAvatarSourceWindows` 按每句实测 TTS 时长烘焙裁剪/回绕窗口，窗口时长之和必须精确等于实测时长（组装期硬校验）。
- 源视频短于配音时回绕拼接并如实提示源偏短；旧「口播切片」项目仅存量保留、走 v3 原声字幕路径。

### 3. 流式脚本与 AI 强调词

- 分镜生成改 `script-progress` 流式呈现：骨架句卡 + 流水文本，与其他 AI 板块一致。
- 分镜句由 AI 自动配置 `emphasisWords`（每句最多 2 词、必须逐字在句内），净化后进入字幕 cue 放大呈现；字幕完整性回归断言（比例路径 cue 拼接去空白 === 口播全文）。

### 4. 软违规与校验边界

- 单镜 300ms 下限与总时长 15–60 秒改为软违规提示，不阻塞合成；硬违规（非法时长、镜头数越界、数字人窗口不守恒）仍拒绝。
- 原创性校验移至脚本生成期；配音完成后不再被合成期原创性阻断。

TypeScript 层验证：定向测试（含一键违规捕获、bypass 推导、字幕完整性回归）与 `pnpm check` 全绿；数字人真实 API harness 复现（MiMo 8 句脚本 → 配音总时长 30.88s → v4 计划组装成功）已在源码任务周期完成并记录。

## 发布命令与后验

在仓库根目录使用：

```powershell
.\scripts\build-android-release.ps1
```

该命令本轮完成并通过：

- Web production build 与 Capacitor Android sync；
- `:app:testReleaseUnitTest`、`:app:lintRelease`、`:app:assembleRelease`；
- APK 包名、源码版本一致性（`0.1.26`/code34）、16 KiB `zipalign`；
- 非 Debug 正式签名、v2/v3 签名、证书 SHA-256 锚定；
- APK SHA-256 计算与 `output/apk-archive/` 独立版本归档。

没有删除、覆盖或重命名历史 APK；`v0.1.25` 及更早归档保持原样。

## 未覆盖边界

- 本轮没有物理 Android 手机端测，因此不声称真实触控、OEM WebView、外部选择器、真实媒体 I/O 或升级链路在物理设备通过。
- 本轮除数字人 harness 复现外没有新的真实 AI Provider 全链路请求；真实 Provider、物理真机和最终成片全链路仍需用户端测验收。
- 公网上传、`download.html` 推荐切换与公网文件回验未完成，不得对外声称 `v0.1.26` 已发布。
