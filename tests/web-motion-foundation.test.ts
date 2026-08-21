import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("mobile motion foundation keeps each interaction responsibility isolated", () => {
  for (const relativePath of [
    "motion/tokens.ts",
    "motion/sheet-dismiss.ts",
    "motion/skeleton-hold.ts",
    "components/Overlay.tsx",
    "components/PageSkeleton.tsx",
    "components/RouteTransition.tsx",
    "components/SwipeRouteViewport.tsx",
    "hooks/useInteractionFeedback.ts",
    "hooks/useSwipeNavigation.ts",
    "hooks/useScrollMotion.ts",
    "services/interaction-feedback.ts",
  ]) {
    assert.equal(existsSync(join(root, relativePath)), true, `${relativePath} should exist`);
  }

  assert.match(read("components/RouteTransition.tsx"), /AnimatePresence/);
  assert.match(read("components/RouteTransition.tsx"), /MotionConfig/);
  assert.match(read("components/RouteTransition.tsx"), /mode="popLayout"/);
  assert.doesNotMatch(read("components/RouteTransition.tsx"), /mode=["']wait["']/);
  assert.match(read("components/Overlay.tsx"), /placement === "rise"/);
  assert.match(read("components/Sheet.tsx"), /OverlayDragRegion/);
  assert.match(read("motion/tokens.ts"), /primaryRouteOffset/);
  assert.match(read("hooks/useSwipeNavigation.ts"), /onPointerDown/);
  assert.match(read("hooks/useScrollMotion.ts"), /passive/);
});

test("mobile feedback uses native capabilities with safe fallbacks", () => {
  const source = read("services/interaction-feedback.ts");
  const hook = read("hooks/useInteractionFeedback.ts");

  assert.match(source, /AudioContext/);
  assert.match(source, /vibrate/);
  assert.match(source, /catch/);
  assert.match(hook, /data-feedback/);
  assert.match(hook, /prefers-reduced-motion/);
});

test("motion stylesheet exposes shared timing and keeps scrolling available", () => {
  const tokens = readFileSync(join(root, "styles", "tokens.css"), "utf8");
  const foundation = readFileSync(join(root, "styles", "foundation.css"), "utf8");

  for (const token of [
    "--motion-duration-instant",
    "--motion-duration-fast",
    "--motion-duration-standard",
    "--motion-duration-page",
    "--motion-duration-primary",
    "--motion-duration-overlay",
    "--motion-ease-standard",
    "--motion-scale-press",
    "--motion-distance-primary",
    "--motion-duration-skeleton",
    "--overlay-scrim",
  ]) {
    assert.match(tokens, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${token} should exist`);
  }

  assert.match(foundation, /scrollbar-width:\s*none/);
  assert.match(foundation, /::-webkit-scrollbar/);
  assert.match(foundation, /prefers-reduced-motion/);
  assert.match(foundation, /html\s*\{[^}]*overscroll-behavior:\s*none/s);
  assert.match(foundation, /body\s*\{[^}]*overscroll-behavior:\s*none/s);
});

test("web app declares Motion as its only new animation runtime", () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "apps", "web", "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };

  assert.equal(packageJson.dependencies?.motion, "12.43.0");
});

test("route motion direction follows primary navigation and detail back paths", () => {
  const router = read("router.ts");

  assert.match(router, /routeTransitionDirection/);
  assert.match(router, /primaryNavigationOrder/);
  assert.match(router, /navKey: "ai"/);
});

test("route motion and feedback are mounted at the shared application boundaries", () => {
  const app = read("App.tsx");
  const shell = read("components/AppShell.tsx");
  const navigation = read("components/BottomNav.tsx");

  assert.match(app, /RouteTransition/);
  assert.match(app, /SwipeRouteViewport/);
  assert.match(app, /useInteractionFeedback/);
  assert.match(shell, /useScrollMotion/);
  assert.match(shell, /data-scroll-state/);
  assert.match(navigation, /whileTap/);
});

test("bottom navigation stays outside route transforms and supports direct navigation", () => {
  const app = read("App.tsx");
  const shell = read("components/AppShell.tsx");
  const navigation = read("components/BottomNav.tsx");
  const routeTransition = read("components/RouteTransition.tsx");
  const browserRoute = read("hooks/useBrowserRoute.ts");

  assert.match(navigation, /createPortal/);
  assert.match(navigation, /document\.body/);
  assert.match(navigation, /transition:\s*["']primary["']/);
  assert.match(read("components/SwipeRouteViewport.tsx"), /transition:\s*["']instant["']/);
  assert.match(app, /AppShellNavigationProvider/);
  assert.match(app, /showsPrimaryNav/);
  assert.match(app, /showPrimaryNav \? <BottomNav active=/);
  assert.match(shell, /data-visual-theme=\{visualTheme\}/);
  assert.match(shell, /externalNavigationContext/);
  assert.match(app, /transitionMode/);
  assert.match(app, /searchEpoch/);
  assert.match(browserRoute, /transitionMode/);
  assert.match(browserRoute, /searchEpoch/);
  assert.match(browserRoute, /splitLocationHref/);
  assert.match(routeTransition, /transitionMode\s*===\s*["']instant["']/);
  assert.match(read("router.ts"), /"primary" \| "push" \| "instant"/);
  assert.match(read("hooks/useBrowserRoute.ts"), /transition \?\? "push"/);
});

test("horizontal navigation renders an adjacent route pane during movement", () => {
  const swipe = read("hooks/useSwipeNavigation.ts");
  const navigation = read("navigation/primary-nav.ts");
  const viewport = read("components/SwipeRouteViewport.tsx");
  const shell = read("styles/shell.css");

  assert.match(swipe, /pointerType\s*===\s*["']mouse["']/);
  assert.match(swipe, /onPointerMove/);
  assert.match(swipe, /setPointerCapture/);
  assert.match(swipe, /start\.direction = "horizontal"[\s\S]*capturePointer\(event\)/);
  assert.match(swipe, /start\.direction = "vertical"[\s\S]*releasePointer\(event\)/);
  assert.doesNotMatch(swipe, /origin\.current = \{[\s\S]*?setPointerCapture/);
  assert.match(swipe, /onCommit/);
  assert.match(swipe, /isSettling/);
  assert.match(swipe, /window\.innerWidth/);
  assert.match(swipe, /swipeOffset/);
  assert.match(swipe, /deltaX\s*<\s*0/);
  assert.match(navigation, /currentIndex/);
  assert.match(navigation, /direction\s*===\s*["']next["']/);
  assert.match(navigation, /currentIndex\s*\+\s*1/);
  assert.match(navigation, /currentIndex\s*-\s*1/);
  assert.match(viewport, /route-swipe-track/);
  assert.match(viewport, /previousPath/);
  assert.match(viewport, /nextPath/);
  assert.match(viewport, /onTransitionEnd/);
  assert.match(viewport, /routeCommitPath/);
  assert.match(viewport, /requestAnimationFrame/);
  assert.match(viewport, /isRouteCommit/);
  assert.match(shell, /route-swipe-viewport/);
  assert.match(shell, /repeat\(3,\s*100%\)/);
  assert.match(shell, /\.route-swipe-track--route-commit[\s\S]*transition:\s*none/);
  assert.match(shell, /overflow-x:\s*hidden/);
});

test("swipe preview panes stay inert and do not list, subscribe, or consume", () => {
  const viewport = read("components/SwipeRouteViewport.tsx");
  const app = read("App.tsx");

  assert.doesNotMatch(viewport, /renderRoute\s*\(/);
  assert.doesNotMatch(viewport, /\.list\s*\(|subscribe|consume/);
  assert.match(viewport, /aria-hidden/);
  assert.match(viewport, /data-visual-theme/);
  assert.match(app, /\{renderRoute\(pathname\)\}/);
  assert.doesNotMatch(app, /renderRoute=\{renderRoute\}/);
});

test("material library header nudge uses motion tokens and is fully still when motion is reduced", () => {
  const styles = read("styles/components.css");

  assert.match(styles, /\.material-library-entry[\s\S]*?var\(--motion-ease-standard\)/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce[\s\S]*\.material-library-entry[\s\S]*animation:\s*none/);
});

test("shared controls expose one press-feedback vocabulary", () => {
  const buttons = read("components/Buttons.tsx");
  const cards = read("components/GlassCard.tsx");
  const components = read("styles/components.css");
  const shell = read("styles/shell.css");

  assert.match(buttons, /button--\$\{size\}/);
  assert.match(cards, /glass-card--interactive/);
  assert.match(cards, /data-feedback/);
  assert.match(components, /--motion-duration-fast/);
  assert.match(components, /\.button:active/);
  assert.match(components, /\.glass-card--interactive:active/);
  assert.match(components, /\.tabs button:active/);
  assert.match(shell, /route-swipe-viewport[\s\S]*touch-action:\s*pan-y/);
});
