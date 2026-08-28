# v0.1.25 Release 验收记录（公网分发与下载页切换完成）

## 结论

制作板块「文稿先行」深度重构（spec `rebuild-production-pipeline`）的源码已按任务周期完成 TypeScript 层实现、运行时边界和 Android Release 编译校验；随后将 Android 源码推进到 `versionName=0.1.25` / `versionCode=33`，使用仓库外正式签名配置完成 Release 构建、签名后验和独立归档。

`v0.1.25` 已上传公网（`https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.25.apk`），完整下载回验大小与 SHA-256 均与本地归档一致；`download.html` 公开推荐已切换为 `v0.1.25`，`v0.1.24` 降为历史版本。主机/模拟器门禁不等于物理手机、真实 Provider 或最终成片全链路通过。

## 版本与文件

| 项目 | 结果 |
| --- | --- |
| applicationId | `com.hongtai.aiagent` |
| versionName | `0.1.25` |
| versionCode | `33` |
| Release APK | `output/apk-archive/HongTai-AI-Agent-release-v0.1.25.apk` |
| APK 大小 | `23,379,102` bytes（本地归档与公网文件一致） |
| APK SHA-256 | `2545ce401283badfbc4b85a782084e7e85ce47469f2f1564ac8c2c9cb73e03e8`（公网文件已下载回验一致） |
| 证书 SHA-256 | `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde` |
| 公开推荐 | `v0.1.25` / code33（`download.html` 已切换，回验完成） |

## 文稿先行管线的端侧保证链路

### 1. 分阶段会话页与一句话需求表单

- 创建表单只要求一句话需求必填；来源拆解、主文字、文字预设、贴纸折叠进高级项，拆解不再是建项目前置。
- 工作台按「需求 → 分镜文稿 → 配音 → 合成 → 成片」阶段推进，每阶段一个产物与一个主按钮；AI 流式写出逐句分镜文稿，逐句核对后再进入配音。
- 每阶段只做一件事、进度随时可见；不伪造阶段完成或后台续跑。

### 2. 实测时长与软边界

- 移除预设时长四选一；每镜时长改为对应句实测 TTS 音频时长。
- 总时长超出 15–60 秒软边界时提示回改或确认后继续，不再强制选择或静默截断。

### 3. 逐句编辑与局部重建

- 分镜卡片支持逐句编辑文案、素材与贴纸；改了哪句只重新配音该句，其余句子保持已就绪状态。
- `updateStoryboard` 逐句编辑与诚实重建边界锁定在测试中；`/create/:projectId/edit` 退役为兼容重定向。

### 4. 字幕时间戳来源

- 字幕 cue 边界优先来自实测时间戳：Provider 支持原生时间戳时直用，OpenAI 兼容路径用词级转写反查并如实标注 `asr-fallback` 精度差异。
- 不再按字数估算铺满镜头；机器对不上的句子不伪装成精确对齐。

### 5. v4 计划与存量兼容

- 制作计划升级 `production-plan.v4`；旧 v3 项目只读兼容渲染，存量本地项目不失效，仍可打开并重新出片。
- 「数字人」模式改名「口播切片」，语义不变：自带口播 MP4 + 逐字稿 + 时长上限校验；UI 不暗示生成数字人形象或口型。

TypeScript 层验证：`pnpm check` 全绿（613 web + 145 runtime 测试）与 `pnpm --filter @hongtai/web build` 通过（2026-08-28 重构合入时）；本轮发布前 web production build 再次通过。

## 发布命令与后验

在仓库根目录使用：

```powershell
.\scripts\build-android-release.ps1
```

该命令本轮完成并通过：

- Web production build 与 Capacitor Android sync；
- `:app:testReleaseUnitTest`、`:app:lintRelease`、`:app:assembleRelease`；
- APK 包名、源码版本一致性、16 KiB `zipalign`；
- 非 Debug 正式签名、v2/v3 签名、证书 SHA-256 锚定；
- APK SHA-256 计算与 `output/apk-archive/` 独立版本归档。

本轮排障记录：`android/local.properties` 内容已正确转义（`sdk.dir=C\:/...`），但文件为 CRLF 行尾，lint `PropertyEscape` 把行尾 CR 视为值中未转义控制字符而报错；且 Gradle 未把该文件纳入 lint 任务的 up-to-date 输入，修改后仍命中旧分析缓存。修复为 LF 行尾并清除 `android/app/build/intermediates` 下 lint 中间产物后重新分析，`lintRelease` 通过。`local.properties` 在 `.gitignore` 中，不进入版本控制。没有删除、覆盖或重命名历史 APK。

## 未覆盖边界

- 本轮没有物理 Android 手机端测，因此不声称真实触控、OEM WebView、外部选择器、真实媒体 I/O 或升级链路在物理设备通过。
- 本轮没有真实 AI Provider 请求，因此不声称网络、Key、解析平台、ASR/视觉模型或最终成片端到端通过。
- 真实 Provider、物理真机和最终成片全链路仍需用户端测验收。
