# Capacitor runtime

本包把共享 Flow 与 Android I/O 组装成 `AppRuntime`。React 入口（`apps/web/src/main.tsx`）注入 Capacitor 的 `registerPlugin`；本包不 import `@capacitor/core`，以便在 WebView 外单测。

- 组合根：`src/standalone-app-runtime.ts`（含 `replica`）。
- 插件形状：`src/standalone-bridge.ts`。实际 Kotlin 在 `android/app`。
- `CapacitorAiTransport` 不持有 API Key，并拒绝 Authorization 等头；密钥只在原生请求路径从 Keystore 解密后附加。
- `NativeNetwork`、`MediaRuntime`、`ProductionRuntime` 已接通真实 HTTPS、采集媒体工具和 Media3，不得再写成 phase-5 占位。

浏览器开发态由 `apps/web` 的 `runtime/browser-native` 提供同一套插件形状；合成故意不可用。
