# v0.1.24 Release 验收记录（端侧主机门禁与本地归档通过）

## 结论

本轮四项功能已按任务周期分别完成代码、运行时边界和 Android Release 编译校验；随后将 Android 源码推进到 `versionName=0.1.24` / `versionCode=32`，使用仓库外正式签名配置完成 Release 构建、签名后验和独立归档。

本地候选 APK 与构建产物逐字节一致。`download.html` 和公网推荐仍保持已上传的 `v0.1.23`，本轮没有把未上传的 `v0.1.24` 写成公开下载或发送到公网。主机/模拟器门禁不等于物理手机、真实 Provider 或最终成片全链路通过。

## 版本与文件

| 项目 | 结果 |
| --- | --- |
| applicationId | `com.hongtai.aiagent` |
| versionName | `0.1.24` |
| versionCode | `32` |
| Release APK | `output/apk-archive/HongTai-AI-Agent-release-v0.1.24.apk` |
| APK 大小 | `23,354,343` bytes |
| APK SHA-256 | `53978b4f30de3d0173d2c00876ce0f09c18389894b469a618965c5af36acdd45` |
| 证书 SHA-256 | `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde` |
| 公开推荐 | 仍为 `v0.1.23` / code31；本轮未上传新 APK |

## 四项功能的端侧保证链路

### 1. 懒加载骨架统一时序

- 路由 `Suspense` 与页面数据骨架共享同一个导航开始时间，不再分别启动两次最短停留计时。
- 页面仍使用统一动效和骨架组件；真实数据读取结束后再进入稳定页面，未引入假进度或假业务结果。
- 定向测试覆盖路由骨架时间基准，完整主测试集也通过。

### 2. 本地存储分析与定向清理

- `AppRuntime.storage` 是唯一业务入口；Android `LocalStorage` 插件只返回受控的私有文件摘要、分类、大小和不透明删除句柄。
- 页面按任务、观察、制作、模板、缓存、应用数据六类汇总；媒体/缓存逐项删除后重新读取快照，数据文件和 Keystore 明确保留。
- Android 与浏览器开发态均采用受控目录扫描，拒绝越界、路径分隔符、NUL 和过期删除句柄；删除失败不会覆盖现有成功状态。
- 存储服务、Android 插件边界、Web 路由和页面契约均有定向测试。

### 3. 模板视频封面

- 模板只读取安全的来源任务详情投影，不读取原始平台响应、私有路径或 Cookie。
- 有受控远程封面时使用异步懒加载图片；没有封面时对本地视频只预加载元数据并定位首帧，媒体已清理则显示诚实不可用状态。
- 通过任务详情投影、模板页面资源加载属性、Web production build 和 Android Release 编译校验。

### 4. 最近拆解/观察长按操作

- 最近拆解和最近观察共用长按 hook、底部操作面板、统一动效和二次确认文案；取消只关闭菜单，不触发删除。
- 只有任务 `succeeded/failed/cancelled` 和观察 `succeeded/failed` 可删除；`queued/pending/running` 在 UI 禁用并由运行时服务再次拒绝。
- 观察报告生成、追问和删除按 `sessionId` 串行化；任务删除复用既有终态删除边界；播放板块在 `/playbook` 注册对应组件标本。
- 通过任务/观察服务测试、Web 契约测试、Playbook 注册测试和 Android Release 编译校验。

## 发布命令与后验

在仓库根目录使用：

```powershell
$env:ANDROID_SDK_ROOT = "C:\Android\Sdk"
.\scripts\build-android-release.ps1
```

该命令本轮完成并通过：

- Web production build 与 Capacitor Android sync；
- `:app:testReleaseUnitTest`、`:app:lintRelease`、`:app:assembleRelease`；
- HEIF 固定源码校验与四 ABI CMake 构建；
- APK 包名、源码版本一致性、16 KiB `zipalign`；
- 非 Debug 正式签名、v2/v3 签名、证书 SHA-256 锚定；
- APK SHA-256 计算与 `output/apk-archive/` 独立版本归档。

先前发布脚本因 Android Build Tools 当前 `apksigner --print-certs` 输出为 `Signer #1 certificate DN:`（无旧版预期的冒号）而在证书 DN 正则处停止；已做兼容两种输出形式的最小修复，随后完整 Release 流程成功。没有删除、覆盖或重命名历史 APK。

## 未覆盖边界

- 本轮没有物理 Android 手机端测，因此不声称真实触控、OEM WebView、外部选择器、真实媒体 I/O 或升级链路在物理设备通过。
- 本轮没有真实 AI Provider 请求，因此不声称网络、Key、解析平台、ASR/视觉模型或最终成片端到端通过。
- `download.html` 未切换到 `v0.1.24`，因为新 APK 尚未上传公网；公开下载链路仍以 `v0.1.23` 的历史验收记录为准。
