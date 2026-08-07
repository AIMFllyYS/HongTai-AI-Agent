import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(process.cwd(), "apps", "web", "src");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("mobile controls stay readable between 360 and 430 pixels", () => {
  const components = read("styles/components.css");
  const responsive = read("styles/responsive.css");

  assert.match(components, /\.button\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(components, /\.technical-value[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(responsive, /@media\s*\(max-width:\s*26\.875rem\)/);
  assert.match(responsive, /\.mobile-action-group\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test("approved gesture shell and compact navigation remain mounted", () => {
  const shell = read("styles/shell.css");
  const tokens = read("styles/tokens.css");
  const swipe = read("components/SwipeRouteViewport.tsx");

  assert.match(shell, /--swipe-offset/);
  assert.match(shell, /overscroll-behavior-x:\s*contain/);
  assert.match(swipe, /useSwipeNavigation/);
  assert.match(tokens, /--header-height:\s*3\.5rem/);
  assert.match(tokens, /--nav-height:\s*4rem/);
  assert.match(shell, /\.app-header\s*\{[^}]*position:\s*fixed/s);
  assert.match(shell, /\.app-header\s*\{[^}]*padding-top:\s*calc\([^;]*safe-area-inset-top/s);
  assert.match(shell, /\.app-content\s*\{[^}]*padding-top:\s*calc\([^;]*--header-height[^;]*safe-area-inset-top/s);
  assert.match(read("styles/components.css"), /\.bottom-nav/);
});

test("Android WebView owns edge feedback while system bars stay inset-aware", () => {
  const mainActivity = readFileSync(join(process.cwd(), "android", "app", "src", "main", "java", "com", "hongtai", "aiagent", "MainActivity.kt"), "utf8");

  assert.match(mainActivity, /WindowCompat\.enableEdgeToEdge\(window\)/);
  assert.match(mainActivity, /bridge\.webView\.overScrollMode\s*=\s*View\.OVER_SCROLL_ALWAYS/);
  assert.match(mainActivity, /isAppearanceLightStatusBars\s*=\s*true/);
  assert.match(mainActivity, /isAppearanceLightNavigationBars\s*=\s*true/);
});
