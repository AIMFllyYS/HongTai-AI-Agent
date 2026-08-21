import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
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

test("brand splash reveals the S0 name and tagline with local art type and CSS motion", () => {
  const splash = read("apps/web/src/components/BrandSplash.tsx");
  const css = read("apps/web/src/styles/components.css");
  const tokens = read("apps/web/src/styles/tokens.css");
  const foundation = read("apps/web/src/styles/foundation.css");
  const fontPath = join(root, "apps/web/public/fonts/MaShanZheng-splash.woff2");
  const licensePath = join(root, "apps/web/public/fonts/MaShanZheng-OFL.txt");

  assert.match(splash, /brand-splash__glow/);
  assert.match(splash, /宏泰 AI 智能体/);
  assert.match(splash, /让 AI 帮你把内容做好/);
  assert.match(splash, /brand-splash__tagline/);
  assert.doesNotMatch(splash, /from ["']motion\/react["']/);
  assert.doesNotMatch(splash, /正在启动|准备你的本地内容|%/);

  assert.match(tokens, /--font-splash-tagline:\s*"Ma Shan Zheng"/);
  assert.doesNotMatch(tokens, /--font-display:[^;]*Ma Shan Zheng/);
  assert.doesNotMatch(tokens, /--font-body:[^;]*Ma Shan Zheng/);
  assert.doesNotMatch(tokens, /--font-data:[^;]*Ma Shan Zheng/);
  assert.match(foundation, /font-family:\s*"Ma Shan Zheng"/);
  assert.match(foundation, /\/fonts\/MaShanZheng-splash\.woff2/);
  assert.match(css, /\.brand-splash__tagline\s*\{[^}]*--font-splash-tagline/s);
  assert.match(css, /\.brand-splash__name\s*\{[^}]*--font-display/s);
  assert.doesNotMatch(css, /\.brand-splash__name\s*\{[^}]*--font-splash-tagline/s);

  assert.match(css, /@keyframes brand-splash-plate-in/);
  assert.match(css, /@keyframes brand-splash-tagline-reveal/);
  assert.match(css, /@keyframes brand-splash-glow-in/);
  assert.match(css, /translateY\(2rem\)/);
  assert.match(css, /clip-path:\s*inset\(0 100% 0 0\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*\.brand-splash__plate[\s\S]*animation:\s*none/s);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*\.brand-splash__tagline[\s\S]*clip-path:\s*none/s);

  assert.equal(existsSync(fontPath), true, "splash tagline font subset should be bundled");
  assert.equal(existsSync(licensePath), true, "Ma Shan Zheng OFL text should be bundled");
  const fontSize = statSync(fontPath).size;
  assert.ok(fontSize > 2_000, "splash subset should not be a placeholder");
  assert.ok(fontSize < 80_000, "splash subset should stay a tagline-only file");
  assert.match(read("apps/web/public/fonts/MaShanZheng-OFL.txt"), /SIL Open Font License/);
});
