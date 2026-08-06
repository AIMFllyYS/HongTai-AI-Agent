import type { CapacitorConfig } from "@capacitor/cli";

/**
 * APK packaging configuration. The WebView ships the built React assets; it
 * never receives a development server URL or any `.env` value.
 */
const config: CapacitorConfig = {
  appId: "com.hongtai.aiagent",
  appName: "宏泰AI智能体",
  webDir: "apps/web/dist",
  server: {
    androidScheme: "https",
  },
  android: {
    // The SQLCipher community module is linked as a native-only Gradle
    // dependency. Do not let Capacitor inspect package dependencies and expose
    // its broad `CapacitorSQLite` bridge to the WebView.
    includePlugins: [],
  },
};

export default config;
