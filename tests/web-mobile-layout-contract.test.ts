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
  assert.match(shell, /overscroll-behavior-x:\s*contain/);
  assert.match(shell, /\.route-swipe-track\s*\{[^}]*left:\s*calc\(-100% \+ var\(--swipe-offset/s);
  assert.doesNotMatch(shell, /\.route-swipe-track(?:--dragging|--settling)?\s*\{[^}]*transform:/s);
  assert.match(swipe, /event\.propertyName !== "left"/);
  assert.match(shell, /\.route-swipe-pane:not\(\.route-swipe-pane--current\) \.app-header[^}]*display:\s*none/s);
  assert.doesNotMatch(shell, /\.route-transition\s*\{[^}]*will-change:[^;}]*transform/s);
  assert.match(read("components/RouteTransition.tsx"), /transitionEnd:\s*\{\s*transform:\s*"none"\s*\}/);
  assert.match(swipe, /useSwipeNavigation/);
  assert.match(tokens, /--header-height:\s*3\.5rem/);
  assert.match(tokens, /--nav-height:\s*4rem/);
  assert.match(shell, /\.app-header\s*\{[^}]*position:\s*fixed/s);
  assert.match(shell, /\.app-header\s*\{[^}]*padding-top:\s*calc\([^;]*safe-area-inset-top/s);
  assert.match(shell, /\.app-content\s*\{[^}]*padding-top:\s*calc\([^;]*--header-height[^;]*safe-area-inset-top/s);
  assert.match(read("styles/components.css"), /\.bottom-nav/);
});

test("Android WebView has one safe-area owner and never double-pads the page", () => {
  const mainActivity = readFileSync(join(process.cwd(), "android", "app", "src", "main", "java", "com", "hongtai", "aiagent", "MainActivity.kt"), "utf8");

  assert.match(mainActivity, /WindowCompat\.enableEdgeToEdge\(window\)/);
  assert.match(mainActivity, /window\.statusBarColor\s*=\s*Color\.TRANSPARENT/);
  assert.match(mainActivity, /Web document[\s\S]*owns its safe-area spacing/);
  assert.doesNotMatch(mainActivity, /setOnApplyWindowInsetsListener|setPadding\(safeInsets|requestApplyInsets/);
  assert.match(mainActivity, /bridge\.webView\.overScrollMode\s*=\s*View\.OVER_SCROLL_ALWAYS/);
  assert.match(mainActivity, /isAppearanceLightStatusBars\s*=\s*true/);
  assert.match(mainActivity, /isAppearanceLightNavigationBars\s*=\s*true/);
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
  assert.match(library, /\.template-delete-confirm\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(templates, /className="template-delete-confirm"[\s\S]*className="mobile-action-group"[\s\S]*确认删除模板/);

  const mobile = library.match(/@media\s*\(max-width:\s*26\.875rem\)\s*\{[\s\S]*$/);
  assert.ok(mobile, "library.css should keep a 390px breakpoint");
  assert.doesNotMatch(mobile[0], /\.template-card\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(mobile[0], /\.template-card__open\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/);
});
