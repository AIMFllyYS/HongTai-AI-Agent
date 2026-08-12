# v0.1.5 分支谱系救援与发布验收记录

> 状态：救援分支候选已通过主机和 API 35 模拟器门禁；物理真机与公开 Debug→Release 迁移仍阻断正式发布
>
> 日期：2026-08-13
>
> 候选分支：`rescue/v0.1.5-lineage-recovery`
>
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
| v0.1.5 真实发布身份 | `dd62568` | 已提交；版本递增为 `0.1.5`/12，并撤回错误同名 APK 的可点击入口 |
| 确定性 Android 仪器测试 | `ae08a7c` | 已提交；渲染测试不再依赖模拟器系统 TTS 网络状态 |

最终 Release APK 从可执行源码提交 `ae08a7c425a8dc486d7a8d925702e73f85f96da8` 重新构建；其后的验收记录提交只改文档，不改变 APK 内容。

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
| `pnpm test` | 通过 | 从提交后的源码执行，245/245 通过 |
| `pnpm check` | 通过 | 全工作区 TypeScript、ESLint 与 245/245 测试通过 |
| Web production build | 通过 | Vite production build 完成，626 modules transformed；仅保留既有的大 chunk 提示 |
| Android JVM | 通过 | Debug 70/70、Release 70/70，均为 0 failure / 0 error |
| Android lint | 通过 | Debug 与 Release 均为 0 error、23 个既有 warning |
| Debug 构建 | 通过 | `assembleDebug` 与 `assembleDebugAndroidTest` 成功 |
| API 35 instrumentation | 通过 | 7 项、0 failure、0 error、2 skipped；两个跳过项仅适用于 API 24/25 HEIF fallback |
| 正式签名 Release 构建 | 通过 | 仓库 Release 入口重新执行 Web、Capacitor sync、Release JVM、lint、四 ABI native build 和 `assembleRelease` |
| APK 包内身份 | 通过 | `aapt` 实读 `com.hongtai.aiagent`、`versionName=0.1.5`、`versionCode=12` |
| Release 签名与非 debuggable | 通过 | 16 KiB zipalign、v2/v3 均通过；`application-debuggable` 不存在；证书与公开锚点一致 |
| APK 权限 | 通过 | 仅 INTERNET、ACCESS_NETWORK_STATE、WAKE_LOCK 和 Android 自动生成的非导出 receiver 权限；无相机、相册或存储危险权限 |

第一次 instrumentation 执行中，`ProductionRendererInstrumentationTest` 直接调用模拟器系统 TTS，设备返回网络超时 `-7`。生产渲染器本来就支持注入 `NarrationSynthesizer`，因此测试改为写入固定时长、16 kHz、16-bit、单声道 PCM WAV 的确定性 fixture；随后完整 connected suite 通过。该测试仍由真实 Media3 路径验证竖屏 H.264/AAC 与字幕，不把模拟器在线 TTS 可用性伪装成产品渲染正确性。

构建保留了既有的 Vite 大 chunk、Capacitor `flatDir` 和 Android SDK XML/CMake 兼容提示；它们不是本轮新增错误，所有要求的任务均以退出码 0 完成。

## 锁定的 APK 产物

| 类型 | 相对路径 | 字节数 | SHA-256 | 身份 |
| --- | --- | ---: | --- | --- |
| 正式签名 Release 候选 | `android/app/build/outputs/apk/release/app-release.apk` | 25,943,725 | `48D65860532BF1641222173BA42FFE479EA3180B3B75A146357EB44C25D1DE6D` | 0.1.5/12，non-debuggable，v2/v3，四 ABI |
| Debug QA 候选 | `android/app/build/outputs/apk/debug/app-debug.apk` | 39,095,463 | `278C3CB523EAFADD08CDE66D5CE1033C6F4768626037C6AFE55286B7CA0B41BD` | 0.1.5/12，debuggable，仅供 QA |
| instrumentation 测试包 | `android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk` | 593,254 | `8D35FB7C0283ECC455B8525FDB4321CBEDD64F1BC7A1BF0D6A3302A04FC71DDB` | 仅供 connected test |

Release 签名 DN 为 `CN=HongTai AI Agent Release, O=HongTai AI Agent, C=CN`，公开证书 SHA-256 为 `54DF122CD4F99720C613737815385E771BFAEB17715C160AED178062AB5B2FDE`。ABI 为 `arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64`。

## 设备与升级验收矩阵

| 场景 | 模拟器 | 物理设备 | 当前结论 |
| --- | --- | --- | --- |
| `v0.1.4` Debug → `v0.1.5` Debug 普通覆盖升级 | 通过 | 未执行 | 同 Debug 证书、不卸载、不带 `-d`，code11→code12 成功且 `firstInstallTime` 保持；仅供迁移期 QA |
| 公开 `v0.1.4` Debug → `v0.1.5` Release | 按预期拒绝 | 未执行 | `INSTALL_FAILED_UPDATE_INCOMPATIBLE`；旧 code11 保持不变，这是正式发布前必须制定的数据迁移断点 |
| 同一正式证书旧 Release → `v0.1.5` Release 普通覆盖升级 | 通过 | 未执行 | v3→v12 不卸载、不带 `-d` 成功，`firstInstallTime` 保持 |
| Home/切换应用与进程重建 | 烟测通过 | 未执行 | Home 往返保持同一 PID；`am kill` 后冷启动为新 PID，无致命异常；不等同于真实长任务完整续跑 |
| 相机、Photo Picker、MP4 Picker 取消返回 | 通过 | 未执行 | 三个系统外部 Activity 均真实打开并返回应用，PID 保持，无致命异常 |
| 回调丢失与遗留运行态降级 | 自动化通过 | 未执行 | 共享恢复契约会重读权威 DTO，并将无法可靠续跑的遗留状态终止为稳定 issue；未用真实长任务制造物理机杀进程 |
| 本地 MP4 导入、AI 拆解、制作与删除 | 部分通过 | 未执行 | 选择器取消与 Media3 instrumentation 已通过；本轮无有效 AI Key/真实素材，未重跑完整 AI 链路 |
| 云端 TTS、Media3 H.264/AAC 输出 | 部分通过 | 未执行 | Media3 确定性 instrumentation 通过；云端 TTS 和 OEM 编码器仍需物理机 |

## API 35 模拟器事实

- 唯一设备为 `emulator-5554`，`ro.kernel.qemu=1`，model `sdk_gphone64_x86_64`，Android 15 / API 35 / x86_64，userdebug/dev-keys；不是物理真机。
- 公开 Debug `v0.1.4` 的 APK 为 39,330,485 字节、SHA-256 `1E90709A622A804B81EF7E80CCD462F77BF5D66681A18D331B95077E841D43A9`。覆盖安装当前 Debug v0.1.5 成功，包身份变为 0.1.5/12，首次安装时间保持。
- 把当前正式 Release 直接覆盖上述公开 Debug 包时，Android 返回 `INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match`，并保持旧 0.1.4/11 安装。这不是版本号问题，而是 Debug 与正式证书身份不同。
- 同正式证书基线 `0.0.1`/3（SHA-256 `D9BB081E0494FC1D39BF11AAA4F70363383FFEFAAC76063369325464B79AE591`）首次安装后，使用普通 `adb install --no-streaming -r` 覆盖当前 Release 成功；包身份变为 0.1.5/12，`firstInstallTime=2026-08-12 12:14:26` 保持，冷启动 `Status: ok`，未观察到 AndroidRuntime/libc 致命异常。
- Release 生命周期烟测中，Home 前后 PID 均为 `7825`；进入后台后执行受控 `am kill`，PID 清空；重新启动得到 PID `8014`，首页恢复且无致命异常。该证据证明安全返回和干净进程重建，不证明所有真实 AI/媒体流程能在后台持续运行。
- 本地 MP4 入口真实打开 `com.android.documentsui.picker.PickActivity`；拍照入口真实打开 `com.android.camera2/com.android.camera.CaptureActivity`；选择图片入口真实打开 `com.android.providers.media.photopicker.PhotoPickerActivity`。三者取消后都返回 `com.hongtai.aiagent/.MainActivity`，PID `8014` 保持。
- Release 升级后首页截图为 `C:\Users\AIMFl\AppData\Local\Temp\hongtai-v015-release-upgraded.png`，SHA-256 `DC87B4056C77A0242F0C014B5792BC98E100775851C91E099F549FFCC8B080FC`；进程重建后截图为 `C:\Users\AIMFl\AppData\Local\Temp\hongtai-v015-release-recreated.png`，SHA-256 `2E29D435664030537683627B31D7BE5A53358F8449C555B54DE44E784A2649D1`，均已目视确认是宏泰应用页面。

## 当前发布判定

当前可以称为“`v0.1.5/code12` 正式签名 Release 候选已构建，并通过主机与 API 35 模拟器门禁”，但不能称为“已正式发布”“物理真机通过”或“现有 v0.1.4 用户可直接升级”。当前阻断项有两个：一是没有连接物理 Android 设备，无法完成 OEM 相机/相册、真实媒体、云端 TTS、长任务最小化/进程回收等门禁；二是公开 v0.1.4 使用 Debug 证书，不能覆盖升级到正式证书 APK，必须先确定数据导出/迁移与一次性卸载重装策略。

因此救援分支保留，不回合并 `main`，也不上传、不改线上推荐下载。待物理真机和签名迁移方案通过后，才执行受保护的回合并；未经用户明确授权仍不得推送、上传 APK 或删除备份引用/工作树。
