import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  BRAND_SPLASH_DURATION_MS,
  brandSplashRemainingMs,
  resetBrandSplashClockForTests,
  startBrandSplashClock,
} from "../apps/web/src/runtime/brand-splash";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("brand splash dwells two to three seconds and is not a progress meter", () => {
  assert.ok(BRAND_SPLASH_DURATION_MS >= 2000 && BRAND_SPLASH_DURATION_MS <= 3000);

  resetBrandSplashClockForTests();
  startBrandSplashClock(1_000);
  assert.equal(brandSplashRemainingMs(1_000), BRAND_SPLASH_DURATION_MS);
  assert.equal(brandSplashRemainingMs(1_000 + BRAND_SPLASH_DURATION_MS), 0);
  startBrandSplashClock(9_000);
  assert.equal(brandSplashRemainingMs(1_000 + 400), BRAND_SPLASH_DURATION_MS - 400);

  const main = read("apps/web/src/main.tsx");
  const splash = read("apps/web/src/components/BrandSplash.tsx");
  const css = read("apps/web/src/styles/components.css");

  assert.match(main, /useBrandSplashReady/);
  assert.match(main, /if \(runtime && splashReady\) return <App runtime=\{runtime\} \/>/);
  assert.match(main, /return <BrandSplash \/>/);
  assert.match(main, /<ErrorState/);
  assert.doesNotMatch(main, /正在启动应用|正在准备你的本地内容|假进度|progressbar|SplashScreen/);
  assert.match(splash, /hongtai-app-icon\.png/);
  assert.doesNotMatch(splash, /正在启动|准备你的本地内容|%/);
  assert.match(css, /\.brand-splash\s*\{[^}]*--color-surface-canvas/s);
  assert.match(css, /\.brand-splash__plate\s*\{[^}]*box-shadow:/s);
});

test("Android theme covers the pre-WebView frame without a SplashScreen plugin", () => {
  const styles = read("android/app/src/main/res/values/styles.xml");
  const styles31 = read("android/app/src/main/res/values-v31/styles.xml");
  const launch = read("android/app/src/main/res/drawable/launch_background.xml");
  const colors = read("android/app/src/main/res/values/colors.xml");
  const config = read("capacitor.config.ts");
  const activity = read("android/app/src/main/java/com/hongtai/aiagent/MainActivity.kt");

  assert.match(colors, /name="brand_splash_background">#F2F7F2/);
  assert.match(styles, /android:windowBackground">@drawable\/launch_background/);
  assert.match(launch, /@color\/brand_splash_background/);
  assert.match(launch, /@drawable\/ic_launcher_foreground/);
  assert.match(styles31, /android:windowSplashScreenBackground">@color\/brand_splash_background/);
  assert.match(styles31, /android:windowSplashScreenAnimatedIcon">@drawable\/ic_launcher_foreground/);
  assert.doesNotMatch(config, /@capacitor\/splash-screen/);
  assert.doesNotMatch(activity, /SplashScreen|setPadding|假进度/);
});
