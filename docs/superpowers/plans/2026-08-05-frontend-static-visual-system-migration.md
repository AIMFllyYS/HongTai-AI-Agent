# 前端静态视觉系统迁移第一阶段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改 CLI 和核心业务边界的前提下，新增一个可截图、可替换数据适配器驱动的 React/TypeScript 静态用户端，并迁移设计资产中的代表页面。

**Architecture:** 在 `apps/web` 建立独立 Vite + React 应用。`router.ts` 负责真实 URL 到页面的最小路由映射，`data/visual-adapter.ts` 定义 view model 与可替换 adapter，`components/` 提供共享 token 消费组件，`pages/` 只组合组件和 adapter 数据。现有 `packages/core` 只以类型依赖方式提供任务阶段/状态语义，不改任何既有实现。

**Tech Stack:** React 19、TypeScript strict、Vite、CSS Modules-free global CSS variables、pnpm workspace、Node test runner、Playwright-compatible browser verification。

---

## Task 1: 记录迁移证据并建立前端 package 边界

**Files:**

- Create: `docs/前端静态视觉系统迁移第一阶段.md`
- Create: `docs/superpowers/plans/2026-08-05-frontend-static-visual-system-migration.md`
- Modify: none in source packages

- [x] **Step 1: 复核当前仓库基线和设计资产**

  已完成：确认当前仓库只有 CLI/纯 TypeScript packages，没有前端 route；扫描 `docs/Hong` 的 11 个 PNG、11 个 HTML、2 个 DESIGN.md；只读读取 Stitch 相关项目和设计系统。

- [x] **Step 2: 写入架构边界、资产映射、route 计划、视觉 token、未决项和接口顺序**

  已完成：文档记录 `apps/web` 为最小增量，并明确不修改 CLI/API/DTO/数据库/鉴权/任务状态机。

- [ ] **Step 3: 检查文档 UTF-8 与工作树状态**

  Run: `git diff --check`

  Expected: exit code 0；中文文档没有空格尾部或不可解析的补丁错误。

- [ ] **Step 4: 提交审查阶段**

  Run:

  ```powershell
  git add -- docs/前端静态视觉系统迁移第一阶段.md docs/superpowers/plans/2026-08-05-frontend-static-visual-system-migration.md
  git diff --cached --check
  git commit -m "docs(web): define static visual migration boundary"
  ```

  Expected: 只提交上述两个文档，commit 成功；不包含 `apps/cli`、`packages/*` 或工作区产物。

## Task 2: 新增 `apps/web` 基础工程和共享 token

**Files:**

- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/styles/global.css`
- Modify: `pnpm-lock.yaml`
- Modify: `pnpm-workspace.yaml` only if the existing `apps/*` glob does not include the package automatically
- Modify: root `package.json` only to add a `web`/`web:build` convenience script if needed by the existing command style

- [ ] **Step 1: Add the package manifest without touching existing package manifests**

  `apps/web/package.json` must declare `@hongtai/web`, React, ReactDOM, Vite, the React Vite plugin, and TypeScript-compatible type packages. Its scripts must be:

  ```json
  {
    "typecheck": "tsc -p tsconfig.json",
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
  ```

  Add `@hongtai/core` as a workspace dependency only for type imports. Do not add API clients, state libraries, database packages, or CLI dependencies.

- [ ] **Step 2: Add strict Vite/TypeScript entry files**

  `tsconfig.json` extends `../../tsconfig.base.json`, includes `src/**/*.ts` and `src/**/*.tsx`, and adds `jsx: "react-jsx"`, `lib: ["ES2022", "DOM", "DOM.Iterable"]`, and `types: ["vite/client"]`. Vite config uses `@vitejs/plugin-react` and does not configure a proxy to the CLI.

- [ ] **Step 3: Add token and global CSS from the recorded design system**

  Implement the documented values as CSS variables: `--color-surface`, `--color-surface-card`, `--color-primary`, `--color-primary-strong`, `--color-accent`, `--color-text`, `--color-muted`, `--radius-card`, `--radius-control`, `--space-*`, `--shadow-card`, `--glass-blur`, typography families and safe-area padding. Add `@media (min-width: 720px)` for 24px page gutters and multi-column layouts. Use local system fallbacks after the named design fonts; do not add a remote `@import`.

- [ ] **Step 4: Install and run the new package typecheck/build**

  Run:

  ```powershell
  pnpm install --frozen-lockfile
  pnpm --filter @hongtai/web typecheck
  pnpm --filter @hongtai/web build
  ```

  Expected: all commands exit 0 and `apps/web/dist` is generated. If typecheck fails, make at most two focused fixes; do not widen types with `any` or `@ts-ignore`.

- [ ] **Step 5: Commit the app foundation**

  Run:

  ```powershell
  git add -- apps/web pnpm-lock.yaml pnpm-workspace.yaml package.json
  git diff --cached --check
  git commit -m "feat(web): add static visual app foundation"
  ```

  Expected: staged paths are limited to the new web package and package metadata.

## Task 3: Add adapter-driven route map, shell, icons and shared states

**Files:**

- Create: `apps/web/src/router.ts`
- Create: `apps/web/src/data/visual-types.ts`
- Create: `apps/web/src/data/visual-adapter.ts`
- Create: `apps/web/src/data/static-visual-adapter.ts`
- Create: `apps/web/src/hooks/useBrowserRoute.ts`
- Create: `apps/web/src/components/Icon.tsx`
- Create: `apps/web/src/components/AppShell.tsx`
- Create: `apps/web/src/components/BottomNav.tsx`
- Create: `apps/web/src/components/GlassCard.tsx`
- Create: `apps/web/src/components/StatusBadge.tsx`
- Create: `apps/web/src/components/ProgressSteps.tsx`
- Create: `apps/web/src/components/StatePanels.tsx`
- Create: `apps/web/src/components/Buttons.tsx`
- Create: `apps/web/src/components/MediaFrame.tsx`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Define view models and the adapter interface**

  `visual-types.ts` must define page-specific display models such as `HomeViewModel`, `ProcessingViewModel`, `VideoDetailViewModel`, `GalleryDetailViewModel`, `CreateViewModel`, `PublishViewModel`, `AssetsViewModel`, `SettingsViewModel`, `VitalityScanViewModel`, and `VitalityResultViewModel`. Status fields use existing `TaskStage`/`StageStatus` types where applicable. Add `VisualDataAdapter` methods returning those models and a `source: "design-fixture" | "repository"` marker.

- [ ] **Step 2: Implement the static adapter outside components**

  `static-visual-adapter.ts` owns all example titles, dates, counts, progress values, labels, placeholder media URLs, and diagnostic copy. Components must not contain object literals for these page records. Media URLs must have deterministic CSS fallback behavior and must not be treated as authenticated or user-owned data.

- [ ] **Step 3: Implement the route table and browser navigation**

  Register exactly the routes documented in `docs/前端静态视觉系统迁移第一阶段.md`. Use `history.pushState`, `popstate`, and regular anchor/button navigation without a network API. Unknown paths render a small non-business `NotFound` state with a link back to `/`.

- [ ] **Step 4: Implement shared shell and state components**

  `AppShell` must render the sticky glass header, page content slot, optional contextual action footer, safe-area bottom padding, and optional five-item `BottomNav`. `StatePanels` must include loading, empty, and error variants with icon+text. `ProgressSteps` must render explicit pending/running/succeeded/degraded/failed styles from props and never infer status from Chinese copy.

- [ ] **Step 5: Add a route/data contract test**

  Create `tests/web-visual-boundary.test.ts` with tests that import the route table and static adapter, assert every documented path has a component key, assert all adapter methods return `source === "design-fixture"`, and assert no page data object is exported from a component module. The test must not start a server or call an external URL.

- [ ] **Step 6: Run targeted checks and commit the shared layer**

  Run:

  ```powershell
  pnpm --filter @hongtai/web typecheck
  pnpm exec eslint apps/web/src tests/web-visual-boundary.test.ts
  pnpm exec tsx --test tests/web-visual-boundary.test.ts
  ```

  Expected: exit code 0. Then stage only `apps/web/src`, `tests/web-visual-boundary.test.ts`, and any required root script changes and commit:

  ```powershell
  git add -- apps/web/src tests/web-visual-boundary.test.ts package.json
  git diff --cached --check
  git commit -m "feat(web): add adapter-driven visual shell"
  ```

## Task 4: Implement the core analysis, creation, assets and settings page skeletons

**Files:**

- Create: `apps/web/src/pages/AnalysisHomePage.tsx`
- Create: `apps/web/src/pages/AnalysisProcessingPage.tsx`
- Create: `apps/web/src/pages/AnalysisResultPage.tsx`
- Create: `apps/web/src/pages/AnalysisDetailPage.tsx`
- Create: `apps/web/src/pages/CreatePage.tsx`
- Create: `apps/web/src/pages/AssetsPage.tsx`
- Create: `apps/web/src/pages/SettingsPage.tsx`
- Create: `apps/web/src/pages/NotFoundPage.tsx`
- Create: `apps/web/src/components/AnalysisCard.tsx`
- Create: `apps/web/src/components/SectionHeading.tsx`
- Create: `apps/web/src/components/MetricRow.tsx`
- Create: `apps/web/src/components/Timeline.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/styles/global.css` only for page-level layout classes that cannot be expressed by tokens

- [ ] **Step 1: Compose the analysis home page from adapter data**

  Render the asset `_1` structure: brand header, headline, URL input shell, four capability tiles, recent analysis list, empty-state component, and bottom navigation. The “start analysis” button must navigate to `/analyze/processing` only; it must not invoke `packages/core`, an HTTP request, or a CLI command in this phase.

- [ ] **Step 2: Compose processing and result pages**

  Processing uses `ProgressSteps` and the adapter’s explicit seven stages, including the 82% media progress visual. Result uses the tabbed script structure, timestamp cards, recommended template and contextual bottom action bar. Tabs may switch local presentation state only.

- [ ] **Step 3: Compose video and gallery detail pages**

  Video detail renders media metadata, media frame, metric row, raw/AI tabs and timeline. Gallery detail renders the gallery preview, download affordance and the same analysis timeline primitives. The media source is optional and uses `MediaFrame` fallback; do not include the broken `img` text artifact from the reference PNG.

- [ ] **Step 4: Compose creation, assets and settings pages**

  Creation renders text area, profile context, template carousel, source chips and a fixed create action. Assets renders template/assets tabs, search, category chips and reusable template cards. Settings renders profile card, model configuration groups, disclosure-safe API key mask, general settings and sign-out as inert static controls.

- [ ] **Step 5: Run a full code check and commit the page group**

  Run:

  ```powershell
  pnpm check
  pnpm --filter @hongtai/web build
  ```

  Expected: existing tests plus the boundary test pass, the web build exits 0, and no existing CLI/core source file is modified. Commit with:

  ```powershell
  git add -- apps/web/src/pages apps/web/src/components apps/web/src/styles tests/web-visual-boundary.test.ts
  git diff --cached --check
  git commit -m "feat(web): add analysis and creation page skeletons"
  ```

## Task 5: Implement publish and Vitality AI page skeletons

**Files:**

- Create: `apps/web/src/pages/PublishPage.tsx`
- Create: `apps/web/src/pages/VitalityScanPage.tsx`
- Create: `apps/web/src/pages/VitalityResultPage.tsx`
- Create: `apps/web/src/components/ScoreRing.tsx`
- Create: `apps/web/src/components/RecommendationList.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/styles/global.css`

- [ ] **Step 1: Compose publish page**

  Recreate `_4` as a standalone result surface: vertical preview frame, four platform choices, primary “保存并去发布” action, and two secondary actions. Use inert buttons or local route links only; do not claim successful publishing or invoke third-party apps.

- [ ] **Step 2: Compose Vitality scan page**

  Recreate `ai_warm_soft_tech_1` with the warm token scope: scan frame, capture/upload buttons, advice cards and history card. The page copy must remain reference-only and must not add diagnosis rules or upload requests.

- [ ] **Step 3: Compose Vitality result page**

  Recreate `ai_warm_soft_tech_2` with score ring, completed media cards, face/tongue observation cards, recommendation list and save/consult actions. Keep the data source fixture-only and show no API key, session, or medical claim beyond the supplied visual copy.

- [ ] **Step 4: Run full checks and commit**

  Run:

  ```powershell
  pnpm check
  pnpm --filter @hongtai/web build
  ```

  Expected: exit code 0. Commit only the new pages/components/styles and the route wiring:

  ```powershell
  git add -- apps/web/src/pages apps/web/src/components apps/web/src/styles apps/web/src/main.tsx
  git diff --cached --check
  git commit -m "feat(web): add publish and vitality visual skeletons"
  ```

## Task 6: Browser route verification, screenshots and visual-difference report

**Files:**

- Create: `docs/前端静态视觉系统迁移第一阶段视觉验收.md`
- Create: `artifacts/web-screenshots/` files generated by the browser verification command; keep them untracked if the repository policy does not version visual artifacts
- Modify: `docs/前端静态视觉系统迁移第一阶段.md` only if verified route names or known differences need correction

- [ ] **Step 1: Start the built app**

  Run in one terminal:

  ```powershell
  pnpm --filter @hongtai/web build
  pnpm --filter @hongtai/web preview --host 127.0.0.1 --port 4173
  ```

- [ ] **Step 2: Capture every migrated route at a fixed mobile viewport**

  Use the installed browser automation skill/tool to visit each route at 390×844, wait for `document.fonts.ready` and `networkidle` or a bounded fallback, and save screenshots using route-safe names. Check that `h1`, primary CTA, bottom nav (when enabled), and page body are visible; record HTTP failures and broken media separately from application errors.

- [ ] **Step 3: Capture a desktop smoke viewport**

  Visit `/`, `/analyze/detail/video`, `/create`, `/assets`, `/settings`, and `/vitality/result` at 1280×900 to verify reflow, max-width, card grid and fixed navigation behavior.

- [ ] **Step 4: Write the visual-difference report**

  Compare screenshots to the supplied PNGs and record: restored shell/tokens, restored page hierarchy, intentional structural changes, remote-media/fallback differences, broken reference-asset differences, and pages intentionally static. Do not describe click-through as real business success.

- [ ] **Step 5: Run final verification before the visual commit**

  Run:

  ```powershell
  pnpm check
  pnpm --filter @hongtai/web build
  git diff --check
  git status --short
  ```

  Expected: all checks exit 0; only intended source/docs files are changed; screenshots are either explicitly tracked or explicitly listed as ignored/untracked evidence. Commit the report and any intended source correction:

  ```powershell
  git add -- docs/前端静态视觉系统迁移第一阶段视觉验收.md apps/web/src
  git diff --cached --check
  git commit -m "test(web): verify static visual routes"
  ```

## Closeout checklist

- [ ] `pnpm check` passes with the new web package and boundary test.
- [ ] `pnpm --filter @hongtai/web build` passes.
- [ ] Every documented route returns a rendered page in a real browser.
- [ ] Every migrated page has a screenshot or reproducible screenshot command.
- [ ] No CLI/API/DTO/database/auth/billing/task-state source file changed.
- [ ] No `any`, `@ts-ignore`, deleted test, remote Stitch write, or copied HTML script was introduced.
- [ ] Git commits are split by evidence/foundation/shared-layer/page-group/visual-verification responsibility.
- [ ] Final report distinguishes static visual completion from future real adapter/API work.
