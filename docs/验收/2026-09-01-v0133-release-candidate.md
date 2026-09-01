# v0.1.33 Release 验收记录（候选构建与本地归档完成，未公网分发）

## 结论

模板页「爆款拆解」来源卡片封面不可用的修复（封面投影优先级翻转，本地视频首帧优先）已完成源码、测试与文档锁定；Android 源码推进到 `versionName=0.1.33` / `versionCode=41`，使用仓库外正式签名配置完成 Release 构建、签名后验和独立归档。

本候选**未上传公网、未切换 `download.html`**：公网推荐仍为 `v0.1.32`（code 40）。主机门禁通过不等于物理手机端测通过；构建时 `adb devices` 无设备连接，端侧验证未执行。

## 版本与文件

| 项目 | 结果 |
| --- | --- |
| applicationId | `com.hongtai.aiagent` |
| versionName | `0.1.33` |
| versionCode | `41` |
| Release APK | `output/apk-archive/HongTai-AI-Agent-release-v0.1.33.apk` |
| APK 大小 | `23,410,228` bytes |
| APK SHA-256 | `c49f2ea178f756015c0439b78e93f89e84d03f363b68e663ae29b328c9e6d4b5` |
| 证书 SHA-256 | `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`（与历史发布一致） |
| 公开推荐 | 仍为 `v0.1.32` / code40（`download.html` 未切换） |

## 修复内容与验证

### 根因

- 封面投影 `standalone-task-detail-projection.ts` 的 `content.cover` 把平台远端 `coverUrl` 排在本地已下载 `media/video.mp4` 之前。
- 远端封面经 `safeUrlForDisplay` 剥离签名查询参数（隐私要求）后必然 403，且依赖网络、会过期；模板卡片 `<img>` 加载失败落入「原视频封面不可用」。
- 本地上传任务无 `coverUrl`，自然落到本地视频 `<video preload="metadata">` 首帧，因此一直正常。

### 修复

- `content.cover` 改为本地视频优先、远端封面仅在本地媒体缺失时兜底；模板卡片统一以本地下载/上传视频的第一帧作为缩略图，两条来源路径行为一致。
- 不改 pipeline、不改 Kotlin、不改 UI 组件结构；远端封面 URL 的隐私脱敏与持久化维持原样。
- 存量爆款拆解任务无需数据迁移，读路径生效即恢复。

### 验证

- 投影层单测重写并锁定新契约：本地视频与 `coverUrl` 同时存在时 `cover` 必须是本地视频；本地视频缺失时才回落脱敏远端封面。
- `pnpm check` 全绿（typecheck + lint + 根套件 650 项 + capacitor-runtime 174 项测试）；`pnpm --filter @hongtai/web build` 通过。
- 消费方逐一核对无回归：`TemplatesPage` 沿用 `content.cover` 优先；`TaskDetailPage` 本就视频优先；图文任务的图片画廊不受影响（无视频媒体）。
- 端侧未验证：构建时无 Android 设备/模拟器连接；卡片渲染复用与本地上传相同的 `<video preload="metadata">` 首帧机制（该机制已随历史版本在端侧服役），但本次修复本身未在真机复现核对，安装候选后应进模板页确认爆款拆解模板显示首帧。

## 发布命令与后验

```powershell
.\scripts\build-android-release.ps1
```

该命令本轮完成并通过：

- Web production build 与 Capacitor Android sync；
- `:app:testReleaseUnitTest`、`:app:lintRelease`、`:app:assembleRelease`（四 ABI）；
- APK 包名、源码版本一致性（`0.1.33`/code41）、16 KiB `zipalign`；
- 非 Debug 正式签名、v2/v3 签名、证书 SHA-256 锚定；
- APK SHA-256 计算与 `output/apk-archive/` 独立版本归档（不覆盖历史版本）。
