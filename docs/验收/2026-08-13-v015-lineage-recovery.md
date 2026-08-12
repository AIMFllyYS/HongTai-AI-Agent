# v0.1.5 分支谱系救援与发布验收记录

> 状态：源码候选准备中，尚未正式发布  
> 日期：2026-08-13  
> 候选分支：`rescue/v0.1.5-lineage-recovery`  
> 目标身份：`com.hongtai.aiagent` / `versionName=0.1.5` / `versionCode=12`

## 任务边界

本轮只恢复并统一三个已经存在的代码谱系：`main` 的生命周期与异常恢复、`fix/issue05-issue07` 的 Release/Android 兼容与安全修复、`feat/video-workflow-management` 的本地视频和制作管理能力。状态权威仍由共享 `AppRuntime`、任务/诊察/制作仓储和版本化 DTO 提供；Android 只承担外部 Activity、私有文件、受控网络和媒体 I/O。

本轮不新增常驻后台服务，不声称 Android 能无限后台执行，不新增相机或整库相册危险权限，不上传 APK，不改线上文件，也不在物理设备门禁缺失时回合并 `main`。

## 安全引用与提交谱系

| 用途 | 引用或提交 | 当前结论 |
| --- | --- | --- |
| 原 `main` 保护点 | `backup/20260813-main-before-lineage-rescue` | 已建立；原工作树中的未跟踪 `HongTai.zip` 未移动、未暂存、未修改 |
| Issue #5/#7 来源保护点 | `backup/20260813-issue05-07-source` | 已建立 |
| v0.1.4 视频分支保护点 | `backup/20260813-v014-source` | 已建立 |
| 执行计划 | `1f82019` | 已提交 |
| Release/兼容基线语义合并 | `e07e5a1` | 已提交；定向契约与当时 `pnpm check` 通过 |
| 视频工作流语义合并 | `0d6129d` | 已提交；保留生命周期恢复、模板、删除和本地视频能力 |
| 跨分支生命周期契约 | `6e85c22` | 已提交；完整检查 244/244 通过 |

## 已统一的关键语义

- `@capacitor/app` 生命周期插件与 WebView 89/Huawei 10 兼容基线共存，不用一方覆盖另一方。
- UI 返回前台后重读权威 DTO；运行中采集、拆解、图片观察、制作计划和渲染无法可靠续接时进入幂等中断终态，不永久显示“正在执行中”。
- 本地 MP4 选择器以 `external-activity` 进入统一操作登记；只有真正取得合法 MP4 后才创建任务，回调丢失时引导用户重新选择媒体。
- 制作服务按项目串行化规划、渲染与删除，并同时登记运行操作，避免跨分支合并后恢复逻辑与删除逻辑互相绕过。
- 相机使用系统相机 Intent、FileProvider 和单次 URI 授权；相册使用 Photo Picker 或单项文档 URI。不声明 `CAMERA`、`READ_MEDIA_IMAGES`、`READ_EXTERNAL_STORAGE` 或 `MANAGE_EXTERNAL_STORAGE`。

## 版本与错误产物隔离

源码候选已经从公开推荐测试版 `0.1.4`/11 单调递增到 `0.1.5`/12。`download.html` 继续推荐真正已发布的 `v0.1.4`，在新候选完成构建、设备验收和实际上传前不会伪造 `v0.1.5` 下载地址或哈希。

此前公开同名文件的已知事实如下：

| 字段 | 已核对事实 |
| --- | --- |
| URL | `https://husteread.com/storage/public/HongTai-AI-Agent-debug-v0.1.5.apk` |
| HTTP | `200 OK` |
| 字节数 | `16,491,092` |
| SHA-256 | `9FFB4B8EB4EF6B67FC8C13DD5F8D49D05EAC81E6B9066C5832F83CB9D44E43A7` |
| 包内身份 | `versionName=0.0.1` / `versionCode=3` |
| 签名/构建类型 | Android Debug / debuggable |
| 升级结论 | 不能覆盖当前 `v0.1.4`/11，且不是本救援分支产物；下载页源码已撤下可点击入口 |

即使未来复用相同 URL 上传正确 APK，也必须重新核对字节数、SHA-256、包身份和签名；绝不能沿用上表旧哈希。

## 自动化与产物门禁

| 门禁 | 状态 | 证据 |
| --- | --- | --- |
| 新版本契约先红 | 通过 | 旧配置下 3/3 定向测试按预期失败：code11、未撤回链接、缺少 0.1.5 更新日志 |
| 版本谱系定向测试 | 通过 | 版本、插件、WebView/Release 脚本定向测试 21/21 通过 |
| `pnpm check` | 通过（版本阶段） | TypeScript、ESLint 与 245/245 测试通过；最终产物阶段仍会复验 |
| Web production build | 通过 | Vite production build 完成，626 modules transformed；仅保留既有的大 chunk 提示 |
| Android JVM / lint / Debug | 待执行 | 尚未执行 |
| 正式签名 Release 构建 | 待执行 | 尚未执行 |
| APK 包内身份 | 待执行 | 必须由构建产物实际读取，不只看 Gradle 源码 |
| Release 签名与非 debuggable | 待执行 | 必须由 `apksigner`/manifest 后验确认 |
| APK 字节数与 SHA-256 | 待执行 | 构建后锁定候选产物 |

## 设备与升级验收矩阵

| 场景 | 模拟器 | 物理设备 | 当前结论 |
| --- | --- | --- | --- |
| `v0.1.4` Debug → `v0.1.5` Debug 普通覆盖升级 | 待执行 | 待执行 | 未验证 |
| 同一正式证书旧 Release → `v0.1.5` Release 普通覆盖升级 | 待执行 | 待执行 | 未验证 |
| 最小化/切换应用后继续或明确中断 | 待执行 | 待执行 | 自动化契约已建立，端侧未验证 |
| 相机返回、Photo Picker 返回、回调丢失恢复 | 待执行 | 待执行 | 自动化契约已建立，端侧未验证 |
| 本地 MP4 导入、拆解、制作、删除 | 待执行 | 待执行 | 自动化契约已建立，端侧未验证 |
| 云端 TTS、Media3 H.264/AAC 输出 | 待执行 | 待执行 | 未验证 |

## 当前发布判定

当前只能称为 `v0.1.5/code12` 源码候选，不能称为正式 Release、最新版安装包或物理真机通过。只有正式签名产物、包内身份、哈希、无降级升级和要求的物理设备场景全部通过后，才允许回合并 `main` 并决定是否发布；未获用户明确授权时仍不得推送或上传。
