# Android 后台中断恢复与照片权限验收记录

日期：2026-08-12

## 结论与边界

本次修复已经消除“应用回到前台后仍永久显示正在执行、实际流程已经断开”的假运行状态。当前版本不承诺让依赖 WebView 的整套 TypeScript Flow 在 Android 后台无限续跑；它在冷启动以及真实的后台返回边沿上对所有状态所有者进行统一对账，把已经无法可靠续接的工作写为明确、幂等、可操作的中断终态，并让页面重新读取持久化 DTO。

当前拍照链路不缺权限。应用使用系统相机 Activity 完成一次拍摄，并通过未导出的 `FileProvider` 临时授予一个输出 URI；选择图片使用系统 Photo Picker 或 `ACTION_OPEN_DOCUMENT` 的单项 URI 授权。应用自身不直接控制摄像头，也不扫描共享相册，所以不声明 `CAMERA` 或相册读取危险权限。系统设置显示 `No permissions requested` 是最小权限设计的预期结果，不是 Manifest 漏配。

## 根因

原运行时的长流程由当前 WebView 中的 Promise 和内存订阅驱动。Android 把 Activity 放到后台后可以暂停 WebView、回收渲染器或结束应用进程；`KEEP_SCREEN_ON` 只对可见 Activity 生效，不能形成后台执行契约。原页面又只订阅当前内存事件，没有在恢复时重新读取所有持久化状态，因此出现了“页面仍保留 running 投影，但执行上下文已经不存在”的分裂状态。

简单加入后台 JavaScript Runner 不能修复该问题：它运行在与 WebView 不同且有时限的 JavaScript 上下文中，不能接管已有 Promise、Capacitor 插件调用或 React 状态。直接把整套 Flow 复制到 Kotlin/Service 也会违反仓库单一状态机和分层规则。

## 本次架构实现

1. `packages/core` 增加版本化 `RuntimeRecoveryService`、未完成工作 DTO 和恢复投影，UI 只接触安全契约。
2. `packages/capacitor-runtime` 增加单一内存操作注册表，区分依赖当前 WebView 的 `in-process` 与系统相机/Photo Picker 的 `external-activity`。
3. 采集、内容拆解、图片观察报告、视频制作四个状态所有者各自检查并幂等终止自己的持久化未终态；统一组合层只编排，不复制业务状态机。
4. Web 入口使用官方 `@capacitor/app` 监听 `appStateChange`，只在一次真实 inactive→active 边沿执行对账。存在 `in-process` 工作时受控重载，让冷启动恢复成为唯一写终态路径；只有外部 Activity 时派发页面刷新事件，不破坏仍有效的 Android 回调。
5. 任务首页、处理页、详情页、拆解页、观察入口/报告页和制作页在安全 resume 事件后重新读取 AppRuntime DTO，避免显示陈旧内存投影。

### 恢复映射

| 状态所有者 | 遗留状态 | 恢复结果 | 用户动作 |
| --- | --- | --- | --- |
| URL 采集 | `running` | `interrupted` + `TASK_INTERRUPTED` | `edit_input` |
| 内容拆解 | 拆解 `running` 或任务 `analysisStatus=running` | 两处均为 `failed` + `TASK_INTERRUPTED` | `retry` |
| 图片观察报告 | `running` | `failed` + `TASK_INTERRUPTED` | `retry` |
| 视频制作 | `planning` / `rendering` | `failed` + `TASK_INTERRUPTED` | `retry` |

转换会保留已有媒体、正文、分析、观察图片、素材和制作计划，不自动删除、不覆盖、不自动重跑。重复恢复不会重复追加问题或改变已进入的终态。

## 权限模型核验

最终 APK 的合并 Manifest/PackageManager 请求项为：

- 应用自身的受限动态接收器签名权限；
- `INTERNET`；
- Media3 依赖合并带入的普通安装时权限 `ACCESS_NETWORK_STATE`、`WAKE_LOCK`。

最终 APK 不包含：

- `CAMERA`；
- `READ_MEDIA_IMAGES`；
- `READ_EXTERNAL_STORAGE`；
- `MANAGE_EXTERNAL_STORAGE`。

普通安装时权限不会触发 Android 运行时授权页，也不允许应用读取相机或共享照片。只有未来切换为应用内 CameraX 取景时，才应在独立任务中声明并运行时请求 `CAMERA`，处理拒绝/再次询问，并完成物理真机验收。

## 自动化验证

- `pnpm check`：通过；类型检查、ESLint 和根测试共 197/197 通过。
- `pnpm --filter @hongtai/capacitor-runtime test`：44/44 通过。
- Web 生命周期定向测试：24/24 通过。
- `pnpm --filter @hongtai/web build`：通过；620 个模块完成生产构建，仅有既有的大 chunk 提示。
- `pnpm exec cap sync android`：通过，只发现官方 `@capacitor/app@8.0.0` Capacitor 插件。
- `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug`：JDK 21 与本机 Android SDK 下 `BUILD SUCCESSFUL`，131 个 Gradle task；52 个 JVM 测试通过。
- Android lint：0 error、23 个既有 warning。
- Android Manifest 边界回归测试锁定 `CAMERA`、`READ_MEDIA_IMAGES`、`READ_EXTERNAL_STORAGE`、`MANAGE_EXTERNAL_STORAGE` 均不得出现。
- `git diff --check`、UTF-8/U+FFFD 扫描在最终提交前复跑。

### Debug APK

- 路径：`android/app/build/outputs/apk/debug/app-debug.apk`
- 大小：16,491,092 字节
- SHA-256：`9FFB4B8EB4EF6B67FC8C13DD5F8D49D05EAC81E6B9066C5832F83CB9D44E43A7`
- package：`com.hongtai.aiagent`
- `versionCode=3`、`versionName=0.0.1`、`minSdk=24`、`targetSdk=36`
- Android Debug 证书，APK Signature Scheme v2 验证通过；不是正式 release 包。

## API 35 模拟器端侧验证

端侧使用 AVD `SciChatApi35` 的只读一次性覆盖层，设备为 `sdk_gphone64_x86_64`、API 35，ADB 序列号 `emulator-5556`。覆盖层退出后丢弃，不修改原 AVD 数据。原覆盖层存在更高 `versionCode` 的旧 QA 包，因此先仅在该一次性覆盖层卸载旧包，再安装本次 v3；没有使用 `install -d` 伪造降级成功。

### 后台返回中断恢复

1. 冷启动本次 APK，确认 `MainActivity` 为前台 Activity。
2. 通过 debug `run-as` 向应用私有目录注入一条不含用户数据的最小 `running` 任务，阶段为 `resolve-link`。
3. 发送 `KEYCODE_HOME`；`NexusLauncherActivity` 成为前台，宏泰 `MainActivity` 进入 paused。
4. 再次启动宏泰；Activity 以 `LaunchState: HOT` 返回。
5. 返回约 1 秒后，私有 `task.json` 从 `running` 变为 `interrupted`，保留 `currentStage=resolve-link`，写入 `interruptedAt` 与唯一问题：

```json
{
  "code": "TASK_INTERRUPTED",
  "severity": "warning",
  "userMessage": "应用上次退出时任务尚未完成，请重新提交链接。",
  "retryable": false,
  "action": "edit_input"
}
```

6. 任务首页真实显示红色“已中断”；进入详情后显示上述中文说明和稳定错误码，不再显示“正在执行中”。

### 系统相机与最小权限

1. Android App info 实际显示 `Permissions — No permissions requested`；该项为禁用状态。
2. 进入“舌象与面部观察”，点击“拍摄图片”，前台 Activity 切换为 `com.android.camera2/com.android.camera.CaptureActivity`。
3. 此时宏泰包的 `CAMERA`、`READ_MEDIA_IMAGES`、`READ_EXTERNAL_STORAGE` AppOps 均为 `ignore`；权限未被授予。
4. 取消相机后返回原 Observation 页面，持久化照片操作状态被消费清空，没有误触发 WebView 工作中断恢复。
5. 再次拍摄并在系统相机确认，应用于第一次轮询内返回；真实图片复制到应用私有 `files/media/imports/<uuid>.jpg`，操作状态清空，页面显示拍摄结果并启用“生成观察报告”。

本次证明的是 API 35 模拟器上的真实 Android Activity、PackageManager、私有文件和 WebView 页面闭环，不等同于物理真机或所有 OEM 相机验收。

## 后续真正后台执行路线

如果产品必须在切后台后继续执行，下一阶段不能只延长 WebView 存活时间。应先把长流程拆成可持久化检查点和可幂等执行的原生工作单元，再按工作语义选择 Android 官方机制：

- 可延迟且需要跨进程/重启保证的工作：WorkManager；
- 用户明确发起、耗时的数据传输：适用系统版本上的 user-initiated data transfer job；
- 必须立即、持续且对用户可见的工作：声明正确 service type、持续通知和停止动作的 foreground service。

无论选择哪一种，都必须继续由共享 Flow 决定业务步骤，Kotlin 只执行版本化 work item 和 I/O；还需要检查点、幂等键、进度持久化、取消、重试上限、网络/电量约束、通知权限和 Android 各版本限制。当前降级恢复是引入真正后台执行之前的安全基线。

## 尚未完成的验收

- 没有连接物理 Android 设备，因此没有宣称物理真机通过。
- 仍需覆盖至少一个 Android 13+ Photo Picker 真机和一个 Android 8–12 `ACTION_OPEN_DOCUMENT` 真机。
- 仍需覆盖不同 OEM 相机、内存压力、长时间停留、开发者选项“不保留活动”、进程回收、EXIF 旋转和高像素图片。
- 当前 Debug APK 不是正式 release，未完成团队 release keystore 和正式分发升级链。

## 官方依据

- [Capacitor App lifecycle API](https://capacitorjs.com/docs/apis/app)
- [Capacitor Background Runner](https://capacitorjs.com/docs/apis/background-runner)
- [Android processes and app lifecycle](https://developer.android.com/guide/components/activities/process-lifecycle)
- [Android background tasks](https://developer.android.com/develop/background-work/background-tasks)
- [Android camera intents](https://developer.android.com/media/camera/camera-intents)
- [Android Photo Picker](https://developer.android.com/training/data-storage/shared/photo-picker)
- [Android runtime permissions](https://developer.android.com/training/permissions/requesting)
- [CameraX architecture](https://developer.android.com/media/camera/camerax/architecture)
