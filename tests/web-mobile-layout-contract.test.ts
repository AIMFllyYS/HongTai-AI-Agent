import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(process.cwd(), "apps", "web", "src");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("mobile controls stay readable between 360 and 430 pixels", () => {
  const components = read("styles/components.css");
  const responsive = read("styles/responsive.css");
  const library = read("styles/pages/library.css");
  const tokens = read("styles/tokens.css");
  const home = read("styles/pages/home.css");
  const vitality = read("styles/pages/vitality.css");

  assert.match(components, /\.button\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(components, /\.technical-value[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(responsive, /@media\s*\(max-width:\s*26\.875rem\)/);
  assert.match(responsive, /\.mobile-action-group\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(library, /@media\s*\(max-width:\s*26\.875rem\)[\s\S]*\.template-editor__actions[^}]*grid-template-columns:\s*1fr/);
  assert.match(tokens, /--color-text-on-secondary:\s*var\(--palette-text\)/);
  assert.match(home, /\.home-empty__action\s*\{[^}]*color:\s*var\(--color-text-on-secondary\)/s);
  assert.match(vitality, /\.scan-actions \.button--primary\s*\{[^}]*color:\s*var\(--color-text-on-secondary\)/s);
});

test("approved gesture shell and compact navigation remain mounted", () => {
  const shell = read("styles/shell.css");
  const tokens = read("styles/tokens.css");
  const swipe = read("components/SwipeRouteViewport.tsx");

  assert.match(shell, /--swipe-offset/);
  assert.match(shell, /\.route-swipe-viewport\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(shell, /\.route-swipe-viewport\s*\{[^}]*overscroll-behavior-x:\s*contain/s);
  assert.match(shell, /\.app-content\s*\{[^}]*overscroll-behavior-x:\s*contain/s);
  assert.doesNotMatch(shell, /\.route-swipe-viewport\s*\{[^}]*overscroll-behavior(?:-y)?:\s*none/s);
  assert.doesNotMatch(shell, /\.app-content\s*\{[^}]*overscroll-behavior(?:-y)?:\s*none/s);
  assert.match(shell, /\.route-swipe-track\s*\{[^}]*left:\s*calc\(-100% \+ var\(--swipe-offset/s);
  assert.doesNotMatch(shell, /\.route-swipe-track(?:--dragging|--settling)?\s*\{[^}]*transform:/s);
  assert.match(swipe, /event\.propertyName !== "left"/);
  assert.match(shell, /\.route-swipe-pane:not\(\.route-swipe-pane--current\) \.app-header[^}]*display:\s*none/s);
  assert.doesNotMatch(shell, /\.route-transition\s*\{[^}]*will-change:[^;}]*transform/s);
  assert.match(read("components/RouteTransition.tsx"), /transitionEnd:\s*\{\s*transform:\s*"none"\s*\}/);
  assert.match(swipe, /useSwipeNavigation/);
  assert.match(tokens, /--header-height:\s*2\.75rem/);
  assert.match(tokens, /--nav-height:\s*3rem/);
  assert.match(shell, /\.app-header\s*\{[^}]*position:\s*fixed/s);
  assert.match(shell, /\.app-header\s*\{[^}]*padding-top:\s*max\(env\(safe-area-inset-top\),\s*var\(--native-status-bar-inset\)\)/s);
  assert.match(shell, /\.app-shell--detail \.app-content\s*\{[^}]*padding-top:\s*calc\([^;]*--header-height[^;]*safe-area-inset-top/s);
  assert.match(read("styles/components.css"), /\.bottom-nav/);
});

test("Android WebView has one safe-area owner and never double-pads the page", () => {
  const mainActivity = readFileSync(join(process.cwd(), "android", "app", "src", "main", "java", "com", "hongtai", "aiagent", "MainActivity.kt"), "utf8");

  assert.match(mainActivity, /WindowCompat\.enableEdgeToEdge\(window\)/);
  assert.match(mainActivity, /window\.statusBarColor\s*=\s*Color\.TRANSPARENT/);
  assert.match(mainActivity, /Web document[\s\S]*owns its safe-area spacing/);
  assert.doesNotMatch(mainActivity, /setOnApplyWindowInsetsListener|setPadding\(safeInsets|requestApplyInsets/);
  assert.match(mainActivity, /bridge\.webView\.overScrollMode\s*=\s*View\.OVER_SCROLL_NEVER/);
  assert.match(mainActivity, /isAppearanceLightStatusBars\s*=\s*true/);
  assert.match(mainActivity, /isAppearanceLightNavigationBars\s*=\s*true/);
});

test("keyboard and bottom chrome use Android nav fallback without dvh", () => {
  const manifest = readFileSync(join(process.cwd(), "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
  const shell = read("styles/shell.css");
  const components = read("styles/components.css");
  const observation = read("styles/pages/observation-runtime.css");
  const main = read("main.tsx");
  const inset = read("runtime/visual-viewport-inset.ts");

  assert.match(manifest, /android:name="\.MainActivity"[\s\S]*android:windowSoftInputMode="adjustResize"/);
  assert.match(shell, /--safe-bottom:\s*max\(env\(safe-area-inset-bottom\),\s*var\(--native-nav-bar-inset\)\)/);
  assert.match(shell, /:root\[data-platform="android"\]\s*\{[^}]*--native-nav-bar-inset:\s*24px/s);
  assert.match(shell, /\.app-shell--with-nav\s*\{[^}]*var\(--safe-bottom\)[^;]*var\(--keyboard-inset\)/s);
  assert.match(components, /\.bottom-nav\s*\{[^}]*padding:[^;]*var\(--safe-bottom\)/s);
  assert.doesNotMatch(components, /\.bottom-nav\s*\{[^}]*--keyboard-inset/s);
  assert.match(components, /\.contextual-action\s*\{[^}]*var\(--safe-bottom\)[^;]*var\(--keyboard-inset/s);
  assert.match(observation, /\.observation-follow-up-dock\s*\{[^}]*--safe-bottom[^;]*--keyboard-inset/s);
  assert.match(main, /installVisualViewportInset\(\)/);
  assert.match(inset, /visualViewport/);
  assert.match(inset, /removeProperty\("--keyboard-inset"\)/);
  assert.doesNotMatch(`${shell}\n${components}\n${observation}`, /\b(?:d|s|l)vh\b/);
});

test("template cards keep a two-column layout and do not stretch the delete pill", () => {
  const analysis = read("styles/pages/analysis.css");
  const library = read("styles/pages/library.css");
  const templates = read("pages/TemplatesPage.tsx");
  const analysisDocument = read("components/ContentAnalysisDocument.tsx");
  const tasksRuntime = read("styles/pages/tasks-runtime.css");

  assert.doesNotMatch(analysis, /(?:^|[^a-z-])\.template-card(?:\s|\{|,|:)/m);
  assert.doesNotMatch(analysis, /(?:^|[^a-z-])\.template-card__/m);
  assert.doesNotMatch(analysis, /(?:^|[^a-z-])\.template-meta(?:\s|\{|,|:)/m);
  assert.match(analysisDocument, /className="analysis-template-card"/);
  assert.match(tasksRuntime, /\.analysis-template-card\s*,/);

  assert.match(library, /\.template-card\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s);
  assert.match(library, /\.template-card\s*>\s*\.button\s*\{[^}]*align-self:\s*start/s);
  assert.match(library, /\.template-card\s*>\s*\.button\s*\{[^}]*height:\s*auto/s);
  assert.match(library, /\.template-card\s*>\s*\.button\s*\{[^}]*max-height:\s*var\(--button-height-md\)/s);
  assert.doesNotMatch(library, /\.template-delete-confirm/s, "模板删除确认不再内嵌进编辑器网格");
  assert.match(templates, /<ConfirmDeleteSheet/s, "模板删除确认统一为底部上拉弹层");
  assert.match(templates, /确认删除模板/s);

  const mobile = library.match(/@media\s*\(max-width:\s*26\.875rem\)\s*\{[\s\S]*$/);
  assert.ok(mobile, "library.css should keep a 390px breakpoint");
  assert.doesNotMatch(mobile[0], /\.template-card\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(mobile[0], /\.template-card__open\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/);
});

test("all destructive confirmations use the shared bottom ConfirmDeleteSheet", () => {
  const component = read("components/ConfirmDeleteSheet.tsx");
  const components = read("styles/components.css");
  const panel = read("features/production/production-pipeline-panel.tsx");
  const taskDetail = read("pages/TaskDetailPage.tsx");
  const templates = read("pages/TemplatesPage.tsx");
  const productionCss = read("styles/pages/production-runtime.css");
  const tasksCss = read("styles/pages/tasks-runtime.css");
  const library = read("styles/pages/library.css");

  assert.match(component, /<Sheet/u, "删除确认必须落在底部上拉 Sheet 上");
  assert.match(component, /role="alert"/u);
  assert.match(components, /\.confirm-delete-sheet__body/u);
  assert.match(components, /\.confirm-delete-sheet__actions[^}]*grid-template-columns:\s*1fr 1fr/su);

  for (const [name, source] of [["pipeline panel", panel], ["task detail", taskDetail], ["templates", templates]] as const) {
    assert.match(source, /<ConfirmDeleteSheet/u, `${name} 的删除确认必须走统一弹层`);
  }
  assert.doesNotMatch(productionCss, /\.production-delete-confirm/u);
  assert.doesNotMatch(tasksCss, /\.task-delete-confirm/u);
  assert.doesNotMatch(library, /\.template-delete-confirm/u);
});
