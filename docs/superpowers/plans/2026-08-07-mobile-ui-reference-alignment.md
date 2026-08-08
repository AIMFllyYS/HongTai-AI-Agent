# Mobile UI Reference Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine every live mobile page against the Stitch visual references without changing real runtime behavior, while eliminating overlap, overflow, inconsistent buttons, and low-quality responsive states on 360–430px Android screens.

**Architecture:** Keep `AppShell`, gesture navigation, runtime page controllers, and all application/domain contracts intact. Make shared controls and responsive CSS the primary repair boundary, then apply page-specific composition only where the current structure materially differs from the reference. TTS is a presentation-only planned slot and does not enter `AppRuntime` in this phase.

**Tech Stack:** React 19, TypeScript strict mode, layered CSS, Motion, Vite, Capacitor 8, Node test runner, Android WebView.

---

## File responsibility map

- `apps/web/src/components/Buttons.tsx`: one shared button contract; no page-specific sizing logic.
- `apps/web/src/styles/components.css`: shared buttons, cards, status chips, bottom navigation, and text overflow behavior.
- `apps/web/src/styles/responsive.css`: cross-page 360–430px reflow rules only.
- `apps/web/src/styles/shell.css`: frozen shell dimensions and gestures; inspect and test, do not redesign.
- `apps/web/src/pages/SettingsPage.tsx`: real profile/AI summary plus one presentation-only planned TTS row.
- `apps/web/src/pages/ProfileSettingsPage.tsx`: real local profile form composition.
- `apps/web/src/pages/AiSettingsPage.tsx`: real text/vision/ASR form and probe composition.
- `apps/web/src/styles/pages/settings.css`: `_9`-informed settings hierarchy without fake account features.
- `apps/web/src/pages/TaskHomePage.tsx`: real ingest and task history composition.
- `apps/web/src/pages/TaskProcessingPage.tsx`, `TaskDetailPage.tsx`, `TaskAnalysisPage.tsx`: real task state and artifact composition.
- `apps/web/src/styles/pages/home.css`, `tasks-runtime.css`, `analysis.css`: `_1`, `_8`, `_2`, `_3`, `_5`-informed task visuals.
- `apps/web/src/pages/ObservationStartPage.tsx`, `ObservationReportPage.tsx`: real image/report/chat composition.
- `apps/web/src/styles/pages/observation-runtime.css`, `vitality.css`: Warm Soft Tech observation visuals.
- `apps/web/src/styles/pages/creation.css`, `library.css`: legible planned shells only.
- `tests/web-mobile-layout-contract.test.ts`: static guard for shared responsive and frozen-interaction contracts.
- Existing runtime boundary tests: guarantee the visual work does not replace real services with fixtures.

### Task 1: Lock the shared mobile layout contract

**Files:**
- Create: `tests/web-mobile-layout-contract.test.ts`
- Modify: `apps/web/src/styles/components.css`
- Modify: `apps/web/src/styles/responsive.css`
- Inspect only: `apps/web/src/styles/shell.css`
- Inspect only: `apps/web/src/components/SwipeRouteViewport.tsx`

- [ ] **Step 1: Write the failing shared layout test**

Create a test that requires one-line buttons, bounded text, a 360–430px rule, equal-height action groups, and the already approved compact shell:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(process.cwd(), "apps", "web", "src");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("mobile controls stay readable between 360 and 430 pixels", () => {
  const components = read("styles/components.css");
  const responsive = read("styles/responsive.css");
  assert.match(components, /\.button[\s\S]*white-space:\s*nowrap/);
  assert.match(components, /overflow-wrap:\s*anywhere/);
  assert.match(responsive, /@media\s*\(max-width:\s*26\.875rem\)/);
  assert.match(responsive, /\.mobile-action-group[\s\S]*grid-template-columns:\s*1fr/);
});

test("approved gesture shell and compact navigation remain mounted", () => {
  const shell = read("styles/shell.css");
  const swipe = read("components/SwipeRouteViewport.tsx");
  assert.match(shell, /--swipe-offset/);
  assert.match(shell, /overscroll-behavior-x:\s*contain/);
  assert.match(swipe, /useSwipeNavigation/);
  assert.match(shell, /\.app-header/);
  assert.match(read("styles/components.css"), /\.bottom-nav/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm tsx --test tests/web-mobile-layout-contract.test.ts`

Expected: FAIL because the explicit compact-width and shared action-group contracts are not yet defined.

- [ ] **Step 3: Add the minimal shared CSS contract**

Add shared behavior without changing navigation dimensions or gesture transforms:

```css
.button {
  min-width: 0;
  white-space: nowrap;
}

.breakable-text,
.technical-value {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.mobile-action-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}

.mobile-action-group > .button {
  width: 100%;
  min-height: 2.75rem;
}

@media (max-width: 26.875rem) {
  .mobile-action-group {
    grid-template-columns: 1fr;
  }
}
```

Use selectors scoped to content components. Do not edit `--nav-height`, the compact `.app-header` height, `SwipeRouteViewport`, or the approved overscroll code.

- [ ] **Step 4: Run targeted and full visual foundation tests**

Run: `pnpm tsx --test tests/web-mobile-layout-contract.test.ts tests/web-motion-foundation.test.ts tests/web-visual-foundation.test.ts tests/web-shared-boundary.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit the shared foundation**

```text
git add -- tests/web-mobile-layout-contract.test.ts apps/web/src/styles/components.css apps/web/src/styles/responsive.css
git diff --cached --check
git commit -m "fix(ui): standardize compact mobile content controls"
```

### Task 2: Align settings with the personal-center reference

**Files:**
- Modify: `tests/web-settings-runtime.test.ts`
- Modify: `apps/web/src/pages/SettingsPage.tsx`
- Modify: `apps/web/src/pages/ProfileSettingsPage.tsx`
- Modify: `apps/web/src/pages/AiSettingsPage.tsx`
- Modify: `apps/web/src/styles/pages/settings.css`

- [ ] **Step 1: Write the failing TTS and settings hierarchy assertions**

Extend the settings test:

```ts
test("settings preserve a planned TTS slot without inventing runtime support", () => {
  const settings = read("pages/SettingsPage.tsx");
  assert.match(settings, /data-settings-capability="tts"/);
  assert.match(settings, /TTS 语音合成/);
  assert.match(settings, /尚未接入/);
  assert.doesNotMatch(settings, /runtime\.tts|OpenAI TTS|温润男声/);
});
```

Keep the existing assertions that prohibit PRO, logout, and unsafe API Key exposure.

- [ ] **Step 2: Run settings tests and verify RED**

Run: `pnpm tsx --test tests/web-settings-runtime.test.ts`

Expected: FAIL because the planned TTS row is absent.

- [ ] **Step 3: Recompose the settings summary with real data**

Keep `runtime.profile.get()` and `runtime.aiSettings.getPublic()` unchanged. Add a non-interactive planned row after the real AI connection row:

```tsx
<div aria-disabled="true" className="settings-row settings-row--planned" data-settings-capability="tts">
  <span className="settings-row__icon"><Icon name="record_voice_over" size={19} /></span>
  <span className="settings-row__body">
    <strong>TTS 语音合成</strong>
    <small>保留产品配置入口，当前版本尚未接入</small>
  </span>
  <span className="settings-planned-badge">尚未接入</span>
</div>
```

Do not add `tts` to `AppRuntime`, do not create a click handler, and do not save a TTS provider/model.

- [ ] **Step 4: Apply `_9`-informed settings CSS**

Use a profile hero, grouped setting cards, 44–48px form controls, stable label/help spacing, and mobile action groups. Preserve actual input fields and probe controls. At 360px, avatar actions and probe actions stack rather than shrinking their labels.

```css
.settings-card { overflow: hidden; padding: 0; }
.settings-row { min-height: 4.25rem; padding: var(--space-3) var(--space-4); }
.settings-row--planned { cursor: default; opacity: 1; }
.settings-planned-badge { white-space: nowrap; }
.settings-field input,
.settings-field select { min-height: 3rem; }
@media (max-width: 26.875rem) {
  .avatar-editor__actions,
  .probe-row__action { display: grid; grid-template-columns: 1fr; }
}
```

- [ ] **Step 5: Run settings and boundary tests**

Run: `pnpm tsx --test tests/web-settings-runtime.test.ts tests/web-issue-notice.test.ts tests/web-planned-capabilities.test.ts`

Expected: all tests PASS; TTS remains presentation-only.

- [ ] **Step 6: Commit settings alignment**

```text
git add -- tests/web-settings-runtime.test.ts apps/web/src/pages/SettingsPage.tsx apps/web/src/pages/ProfileSettingsPage.tsx apps/web/src/pages/AiSettingsPage.tsx apps/web/src/styles/pages/settings.css
git diff --cached --check
git commit -m "fix(settings): align real configuration with mobile reference"
```

### Task 3: Refine the real ingest and task pages

**Files:**
- Modify: `tests/web-task-runtime.test.ts`
- Modify: `apps/web/src/pages/TaskHomePage.tsx`
- Modify: `apps/web/src/pages/TaskProcessingPage.tsx`
- Modify: `apps/web/src/pages/TaskDetailPage.tsx`
- Modify: `apps/web/src/pages/TaskAnalysisPage.tsx`
- Modify: `apps/web/src/styles/pages/home.css`
- Modify: `apps/web/src/styles/pages/tasks-runtime.css`
- Modify: `apps/web/src/styles/pages/analysis.css`

- [ ] **Step 1: Add failing structural assertions for real task content**

Require shared content action groups and breakable runtime values while retaining runtime calls:

```ts
test("real task pages use the shared mobile composition without fixture tiles", () => {
  const home = read("pages/TaskHomePage.tsx");
  const processing = read("pages/TaskProcessingPage.tsx");
  const detail = read("pages/TaskDetailPage.tsx");
  assert.match(home, /runtime\.tasks\.create/);
  assert.doesNotMatch(home, /capability-grid|design-fixture/);
  assert.match(processing, /mobile-action-group/);
  assert.match(detail, /technical-value/);
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `pnpm tsx --test tests/web-task-runtime.test.ts`

Expected: FAIL on the new shared composition class requirements.

- [ ] **Step 3: Add semantic wrappers only where responsive behavior needs them**

- Mark source URLs/model-safe identifiers with `technical-value`.
- Mark groups containing peer buttons with `mobile-action-group`.
- Keep one primary action per section and make secondary actions visually quieter.
- Keep every runtime call, task status branch, seven-stage event, empty state, and analysis confirmation unchanged.
- Do not add capability tiles or design fixtures to fill empty space.

- [ ] **Step 4: Rebalance task page CSS against `_1`, `_8`, `_2`, `_3`, `_5`**

Apply 16px cards, consistent 16–20px internal padding, compact metadata rows, bounded media, and readable transcript/analysis text. Use responsive one-column reflow at 430px instead of shrinking controls.

```css
.task-detail-summary,
.task-stage-card { padding: var(--space-4); border-radius: var(--radius-card); }
.task-detail-summary__facts { display:flex; flex-wrap:wrap; gap:var(--space-2); }
.runtime-transcript-card__full { overflow-wrap:anywhere; }
@media (max-width:26.875rem) {
  .task-detail-summary__heading,
  .section-heading { align-items:flex-start; }
}
```

- [ ] **Step 5: Run task, route, issue, and analysis tests**

Run: `pnpm tsx --test tests/web-task-runtime.test.ts tests/web-visual-boundary.test.ts tests/web-issue-notice.test.ts tests/content-analysis-flow.test.ts`

Expected: all tests PASS; task runtime semantics remain unchanged.

- [ ] **Step 6: Commit real task-page refinement**

```text
git add -- tests/web-task-runtime.test.ts apps/web/src/pages/TaskHomePage.tsx apps/web/src/pages/TaskProcessingPage.tsx apps/web/src/pages/TaskDetailPage.tsx apps/web/src/pages/TaskAnalysisPage.tsx apps/web/src/styles/pages/home.css apps/web/src/styles/pages/tasks-runtime.css apps/web/src/styles/pages/analysis.css
git diff --cached --check
git commit -m "fix(tasks): refine real mobile task presentation"
```

### Task 4: Refine observation, report chat, and planned shells

**Files:**
- Modify: `tests/web-observation-runtime.test.ts`
- Modify: `tests/web-planned-capabilities.test.ts`
- Modify: `apps/web/src/pages/ObservationStartPage.tsx`
- Modify: `apps/web/src/pages/ObservationReportPage.tsx`
- Modify: `apps/web/src/styles/pages/observation-runtime.css`
- Modify: `apps/web/src/styles/pages/vitality.css`
- Modify: `apps/web/src/styles/pages/creation.css`
- Modify: `apps/web/src/styles/pages/library.css`

- [ ] **Step 1: Add failing observation layout assertions**

```ts
test("observation actions and follow-up composer use shared mobile groups", () => {
  const start = read("pages/ObservationStartPage.tsx");
  const report = read("pages/ObservationReportPage.tsx");
  assert.match(start, /observation-capture-card__actions mobile-action-group/);
  assert.match(report, /observation-follow-up__actions mobile-action-group/);
  assert.doesNotMatch(`${start}\n${report}`, /健康评分|诊断结果|咨询专家/);
});
```

- [ ] **Step 2: Run observation tests and verify RED**

Run: `pnpm tsx --test tests/web-observation-runtime.test.ts tests/web-planned-capabilities.test.ts`

Expected: FAIL on shared action-group classes.

- [ ] **Step 3: Apply Warm Soft Tech composition without changing diagnosis calls**

- Use equal mode cards at 393–430px and single-column cards at 360px when text would compress.
- Put capture/select peer actions in a shared group; keep “生成观察报告” as the full-width primary action.
- Keep `runtime.diagnosis.captureImage`, `pickImage`, `createSession`, `runReport`, and `followUp` unchanged.
- Keep follow-up textarea multi-line; place retry/send actions in a bounded group that never covers messages.
- Keep quick-question chips as the only horizontally scrollable control.

- [ ] **Step 4: Keep planned shells legible but inert**

Ensure creation/assets/publish disabled controls use readable contrast and 44px minimum height. Do not add counts, progress, thumbnails, success states, upload controls, or click handlers.

- [ ] **Step 5: Run observation, diagnosis, and planned-boundary tests**

Run: `pnpm tsx --test tests/web-observation-runtime.test.ts tests/web-planned-capabilities.test.ts tests/diagnosis-flow.test.ts`

Expected: all tests PASS.

- [ ] **Step 6: Commit observation and planned-shell refinement**

```text
git add -- tests/web-observation-runtime.test.ts tests/web-planned-capabilities.test.ts apps/web/src/pages/ObservationStartPage.tsx apps/web/src/pages/ObservationReportPage.tsx apps/web/src/styles/pages/observation-runtime.css apps/web/src/styles/pages/vitality.css apps/web/src/styles/pages/creation.css apps/web/src/styles/pages/library.css
git diff --cached --check
git commit -m "fix(ui): polish observation and planned mobile pages"
```

### Task 5: Three-width visual audit and APK verification

**Files:**
- Modify only if an evidenced defect remains: files from Tasks 1–4
- Create: `docs/验收/2026-08-07-mobile-ui-reference-alignment.md`

- [ ] **Step 1: Run automated gates**

Run:

```text
pnpm --filter @hongtai/capacitor-runtime test
pnpm check
pnpm --filter @hongtai/web build
```

Expected: Capacitor tests, all root tests, typecheck, lint, and Web production build PASS.

- [ ] **Step 2: Run the browser route matrix at three widths**

Use the running Vite app and inspect these routes at 360×800, 393×852, and 430×932:

```text
/
/settings
/settings/profile
/settings/ai
/observation/new
/tasks/task-e2048db7f8a94a59a6c2f1e7d39dc58d
/tasks/task-e2048db7f8a94a59a6c2f1e7d39dc58d/detail
/tasks/task-e2048db7f8a94a59a6c2f1e7d39dc58d/analysis
/create
/assets
```

For each route, verify:

- `document.documentElement.scrollWidth <= window.innerWidth`;
- no visible pair of buttons overlaps;
- peer buttons have equal heights;
- button labels remain on one line;
- the final content block can scroll above the fixed bottom navigation;
- technical values break inside their card;
- no `U+FFFD` replacement character appears.

- [ ] **Step 3: Confirm frozen interactions**

At 393×852 verify:

- left/right swipe still previews and commits adjacent primary routes;
- top/bottom boundary feedback remains active;
- compact header and bottom navigation retain their current dimensions;
- top notification still auto-dismisses after five seconds and supports upward dismissal.

- [ ] **Step 4: Build and install the Android debug APK**

Run with Android Studio JBR 21:

```text
pnpm --filter @hongtai/web build
pnpm exec cap sync android
cd android
gradlew.bat :app:testDebugUnitTest :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Expected: build and install succeed without clearing application data.

- [ ] **Step 5: Record evidence and artifact identity**

Write the tested widths, routes, defects fixed, frozen-interaction results, emulator/device details, APK absolute path, and SHA-256 to the acceptance document. Do not claim a route was checked without a current screenshot/DOM inspection.

- [ ] **Step 6: Commit the acceptance record**

```text
git add -- docs/验收/2026-08-07-mobile-ui-reference-alignment.md
git diff --cached --check
git commit -m "test(ui): verify mobile reference alignment"
```

## Final completion criteria

- The runtime-backed pages remain the only production routes.
- No task, profile, AI, diagnosis, or planned-feature behavior is replaced with fixtures.
- TTS has one clearly planned presentation slot and no runtime call.
- 360px, 393px, and 430px routes have no page-wide horizontal overflow or overlapping controls.
- Buttons are consistent, readable, and do not wrap labels.
- Approved overscroll, swipe, compact navigation, and notification behavior remain intact.
- Full checks and the rebuilt APK pass before delivery.
