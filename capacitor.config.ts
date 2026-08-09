import type { CapacitorConfig } from "@capacitor/cli";

/**
 * APK packaging configuration. The WebView ships the built React assets; it
 * never receives a development server URL or any `.env` value.
 */
const config: CapacitorConfig = {
  appId: "com.hongtai.aiagent",
  appName: "宏泰AI智能体",
  webDir: "apps/web/dist",
  // Bridge arguments may include write-only AI credentials. Never mirror
  // Capacitor call payloads into Logcat, including in debug APKs.
  loggingBehavior: "none",
  server: {
    androidScheme: "https",
    errorPath: "unsupported-webview.html",
  },
  android: {
    minWebViewVersion: 99,
    // Native plugins are explicitly registered from MainActivity.
    includePlugins: [],
  },
};

export default config;
