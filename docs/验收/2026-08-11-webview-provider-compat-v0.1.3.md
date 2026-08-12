# v0.1.3 WebView provider 兼容修复验收

## 任务契约

### 目标

- 消除 `com.huawei.webview` 被不可达到版本值永久拦截的问题。
- 将标准 WebView 启动与 Web bundle 的共同基线调整为 Chromium 89，使小米 Android 12 的基础 WebView 不会被 Chromium 99 门槛提前拒绝。
- 不放行已知会白屏的过旧标准 WebView，也不把 OEM 产品版本误当成 Chromium 版本。

### 允许修改

- Capacitor Android WebView 配置、Web bundle 编译目标与应用内的 Chrome 89 运行时兼容调用。
- 版本、定向测试、当前能力文档与本验收记录。

### 明确不做

- 不改 AI Provider、媒体导入、视频渲染、用户私有数据、系统权限或网络策略。
- 不宣称 Huawei、MIUI 或物理设备已经通过；本工作站没有已授权目标设备。
- 不增加远程诊断后端、用户跟踪或设备指纹采集。

### 架构归属

- Capacitor 组合层与 Android WebView 打包边界；共享 core 仅提供不依赖 `crypto.randomUUID` 的运行时 ID。
- UI 仍只消费 `AppRuntime`；不向 WebView 暴露原生路径、凭据或原始错误数据。

### 权威状态与数据

- 没有新增任务、会话或项目状态源。
- 生成的 ID 保持 UUID 形状；优先使用 `crypto.getRandomValues`，缺失时只作为非密钥本地标识回退。

### 验收

- 定向 WebView 配置与 ID 测试、`pnpm check`、Web production build、Capacitor sync、Android JVM/lint/Debug APK 构建。
- 产物必须递增至 `versionCode=10`、`versionName=0.1.3`，记录 SHA-256。
- 未连接真机时，明确标记 Huawei/MIUI 真实启动仍待验证。

## 实现

- 标准 provider 从 Chromium 99 调整为 89，并把 Vite target 同步为 `chrome89`。
- Huawei provider 使用 Capacitor 的独立基线 10，移除 `2147483647` 的永久拒绝配置。
- 替换 WebView 89 尚不提供的 `crypto.randomUUID()` 与 `Array.prototype.at()` 调用；Node 专用 transport 未改变。

## 验收结果

- 定向兼容性与运行时 ID 检查通过 6/6；`pnpm check` 通过 230/230（typecheck、lint 与全量测试）。
- `pnpm --filter @hongtai/web build` 成功；`pnpm exec cap sync android` 和生成 XML UTF-8 规范化成功。
- `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest --no-daemon` 成功，包含 arm64-v8a、armeabi-v7a、x86、x86_64 原生编译。
- Debug APK 后验：`com.hongtai.aiagent`、`versionCode=10`、`versionName=0.1.3`、minSdk 24、四 ABI；`apksigner verify --verbose` 的 v2 签名验证通过。APK 为 `39,068,134` bytes，SHA-256 `ae536c5cf6620cb902cea8d9a63b3cddf3a7e884e26604c1c0272daaee9d0d16`。
- `adb devices -l` 无已授权设备。因此本记录只证明源码、打包与静态兼容边界；Huawei、MIUI 与其他物理设备的安装、冷启动和业务路径仍待真机验证，且 Debug 签名不能证明 release 升级链。
