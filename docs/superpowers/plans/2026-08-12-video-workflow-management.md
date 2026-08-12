# Video Workflow Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a real local loop for uploaded-video AI analysis, production deletion, and editable reusable templates, with five active primary navigation destinations.

**Architecture:** Extend the existing shared `AppRuntime`, `IngestPipeline`, and `content-analysis.v1` contracts. Keep all workflow decisions in TypeScript; Android only selects, validates, copies, and deletes files beneath fixed private roots. Persist templates as bounded JSON files and preserve legacy routes without introducing a database, backend, or second AI/media flow.

**Tech Stack:** TypeScript 5, React 19, Zod, Capacitor 8, Kotlin, Android Media3, Node test runner, Gradle/JUnit, Vite.

---

## File map

- `packages/core/src/models.ts`: persisted task source provenance and local-video ingest request.
- `packages/core/src/application-runtime.ts`: deletion, video-import analysis, and template DTO/service contracts.
- `packages/core/src/pipeline.ts`: truthful local-video branch inside the one shared seven-stage executor.
- `packages/ai/src/contracts/content-analysis.ts`, `schemas/content-analysis.ts`: accept explicit `local_upload` provenance.
- `packages/capacitor-runtime/src/standalone-task-service.ts`: task import/delete lifecycle and safe projections.
- `packages/capacitor-runtime/src/standalone-analysis-service.ts`: one-click import → ingest → formal analysis composition.
- `packages/capacitor-runtime/src/standalone-production-service.ts`: single-flight asset/output/project deletion.
- `packages/capacitor-runtime/src/standalone-template-service.ts`: bounded template CRUD and analysis import.
- `packages/capacitor-runtime/src/standalone-bridge.ts`, `standalone-app-runtime.ts`: native ports and composition.
- `android/app/src/main/.../FileMediaPlugin.kt`: system MP4 picker.
- `android/app/src/main/.../media/TaskVideoImportPolicy.kt`, `TaskVideoImportStore.kt`: bounded validation and atomic task copy.
- `android/app/src/main/.../bridge/LocalFilesPlugin.kt`: controlled task/production/template reads, writes, and deletes.
- `apps/web/src/pages/TaskHomePage.tsx`: local-video auto-analysis entry and local provenance display.
- `apps/web/src/pages/CreatePage.tsx`, `components/ProductionProjectCard.tsx`: destructive production actions.
- `apps/web/src/pages/TemplatesPage.tsx`: import, customize, and delete templates.
- `apps/web/src/navigation/primary-nav.ts`, `router.ts`, `App.tsx`: `/assets` → `/templates` migration.
- targeted `.test.ts` and Kotlin JUnit files: red-green coverage for every new behavior.

### Task 1: Shared provenance and local-video pipeline

**Files:**
- Modify: `packages/core/src/models.ts`
- Modify: `packages/core/src/application-runtime.ts`
- Modify: `packages/core/src/pipeline.ts`
- Modify: `packages/ai/src/contracts/content-analysis.ts`
- Modify: `packages/ai/src/schemas/content-analysis.ts`
- Modify: `tests/pipeline.test.ts`
- Modify: `tests/content-analysis-flow.test.ts`
- Modify: `tests/application-runtime.test.ts`

- [ ] **Step 1: Write failing contract and pipeline tests**

Add a pipeline case that calls:

```ts
await new IngestPipeline(dependencies).run({
  taskId: "task-local-video",
  localVideo: { displayName: "口播原片.mp4" },
});
```

Assert seven persisted stages, no adapter/downloader calls, ASR evidence, `sourceKind: "local_video"`, no platform, and no fake URL. Add schema/semantic assertions that `source.platform === "local_upload"` is valid.

- [ ] **Step 2: Run red tests**

Run: `pnpm exec tsx --test tests/pipeline.test.ts tests/content-analysis-flow.test.ts tests/application-runtime.test.ts`

Expected: FAIL because `localVideo`, `TaskSourceKind`, `local_upload`, and new runtime methods do not exist.

- [ ] **Step 3: Implement the minimal shared contracts and pipeline branch**

Use these contract shapes:

```ts
export type TaskSourceKind = "public_link" | "local_video";
export type ContentAnalysisPlatform = SupportedPlatform | "local_upload";

export type IngestRequest =
  | { readonly input: string; readonly taskId?: string; readonly localVideo?: never }
  | { readonly input?: never; readonly taskId: string; readonly localVideo: { readonly displayName: string } };
```

The local branch must report all seven existing `TaskStage` values, probe/extract/split/transcribe the already imported `paths.video`, write safe metadata/transcript/task JSON, and never call a platform adapter or downloader.

- [ ] **Step 4: Run green tests and full core/AI checks**

Run: `pnpm exec tsx --test tests/pipeline.test.ts tests/content-analysis-flow.test.ts tests/application-runtime.test.ts`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

Stage only the eight paths above, run `git diff --cached --check`, then commit: `feat(core): support local video analysis provenance`.

### Task 2: Android private video import and controlled deletion

**Files:**
- Create: `android/app/src/main/java/com/hongtai/aiagent/media/TaskVideoImportPolicy.kt`
- Create: `android/app/src/main/java/com/hongtai/aiagent/media/TaskVideoImportStore.kt`
- Create: `android/app/src/test/java/com/hongtai/aiagent/media/TaskVideoImportPolicyTest.kt`
- Modify: `android/app/src/main/java/com/hongtai/aiagent/bridge/FileMediaPlugin.kt`
- Modify: `android/app/src/main/java/com/hongtai/aiagent/bridge/LocalFilesPlugin.kt`
- Modify: `android/app/src/main/java/com/hongtai/aiagent/media/PrivateArtifactStore.kt`
- Modify: `android/app/src/test/java/com/hongtai/aiagent/bridge/LocalFilesPolicyTest.kt`
- Modify: `packages/capacitor-runtime/src/standalone-bridge.ts`

- [ ] **Step 1: Write failing JVM policy tests**

Test exact acceptance of `content://` + `video/mp4`, rejection of non-MP4/oversize/invalid `ftyp`, template ID validation, and deletion root guards. The pure API is:

```kotlin
TaskVideoImportPolicy.requireSupported(sourceScheme, mimeType, declaredBytes, header)
LocalFilesPolicy.templateId("template-2026_08")
```

- [ ] **Step 2: Run red Android tests**

Run from `android`: `./gradlew testDebugUnitTest --tests "com.hongtai.aiagent.media.TaskVideoImportPolicyTest" --tests "com.hongtai.aiagent.bridge.LocalFilesPolicyTest"`

Expected: FAIL because the policy and template/delete paths do not exist.

- [ ] **Step 3: Implement native I/O only**

Add `FileMedia.pickVideo({taskId})`, copying one selected MP4 directly to fixed `tasks/<taskId>/media/video.mp4` on a background executor. Add bridge methods:

```ts
deleteTask({ taskId }): Promise<void>;
deleteProduction({ projectId }): Promise<void>;
deleteProductionFile({ projectId, relativePath }): Promise<void>;
ensureTemplate({ templateId }): Promise<void>;
writeTemplateText(...): Promise<void>;
readTemplateText(...): Promise<{ value?: string }>;
listTemplateIds(): Promise<{ templateIds: readonly string[] }>;
deleteTemplate({ templateId }): Promise<void>;
```

Every delete resolves a validated canonical descendant and fails if recursive removal is incomplete.

- [ ] **Step 4: Run Android green tests**

Run: `./gradlew testDebugUnitTest --tests "com.hongtai.aiagent.media.TaskVideoImportPolicyTest" --tests "com.hongtai.aiagent.bridge.LocalFilesPolicyTest"`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

Exact-stage the eight paths, run `git diff --cached --check`, commit: `feat(android): add private video import and deletion ports`.

### Task 3: Runtime deletion and template services

**Files:**
- Modify: `packages/capacitor-runtime/src/standalone-task-service.ts`
- Modify: `packages/capacitor-runtime/src/standalone-task-service.test.ts`
- Modify: `packages/capacitor-runtime/src/standalone-analysis-service.ts`
- Modify: `packages/capacitor-runtime/src/standalone-analysis-service.test.ts`
- Modify: `packages/capacitor-runtime/src/standalone-production-service.ts`
- Modify: `packages/capacitor-runtime/src/standalone-production-service.test.ts`
- Create: `packages/capacitor-runtime/src/standalone-template-service.ts`
- Create: `packages/capacitor-runtime/src/standalone-template-service.test.ts`
- Modify: `packages/capacitor-runtime/src/standalone-app-runtime.ts`
- Modify: `packages/capacitor-runtime/src/index.ts`

- [ ] **Step 1: Write failing service tests**

Cover these exact observable behaviors:

```ts
await analysis.importVideo();              // picker -> pipeline -> analysis
await tasks.delete("terminal-task");       // deletes root
await production.removeAsset(pid, aid);    // clears plan/output
await production.removeOutput(pid);        // keeps plan, status ready
await production.delete(pid);              // disappears from list
await templates.createFromAnalysis(taskId);
await templates.update(templateId, input);
await templates.delete(templateId);
```

Also assert running/planning/rendering deletion rejection and same-ID single-flight.

- [ ] **Step 2: Run red service tests**

Run: `pnpm exec tsx --test packages/capacitor-runtime/src/standalone-task-service.test.ts packages/capacitor-runtime/src/standalone-analysis-service.test.ts packages/capacitor-runtime/src/standalone-production-service.test.ts packages/capacitor-runtime/src/standalone-template-service.test.ts`

Expected: FAIL on missing methods/module.

- [ ] **Step 3: Implement minimal services and composition**

Use `Map<string, Promise<unknown>>` keyed single-flight guards. Template inputs are trimmed and bounded to name 80, summary/formula 2,000, 40 steps, 40 variables, and 300 characters per row. `createFromAnalysis` copies `reusableTemplate` from a validated formal document; it never stores provider output or reasoning.

- [ ] **Step 4: Run green service tests and typecheck**

Run the command from Step 2, then `pnpm --filter @hongtai/capacitor-runtime typecheck`.

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

Exact-stage the ten paths, check cached whitespace, commit: `feat(runtime): manage local videos productions and templates`.

### Task 4: Activate templates and expose safe delete actions

**Files:**
- Modify: `apps/web/src/pages/TaskHomePage.tsx`
- Modify: `apps/web/src/pages/TaskProcessingPage.tsx`
- Modify: `apps/web/src/pages/TaskDetailPage.tsx`
- Modify: `apps/web/src/pages/TaskAnalysisPage.tsx`
- Modify: `apps/web/src/pages/CreatePage.tsx`
- Modify: `apps/web/src/components/ProductionProjectCard.tsx`
- Create: `apps/web/src/pages/TemplatesPage.tsx`
- Delete: `apps/web/src/pages/AssetsPage.tsx`
- Modify: `apps/web/src/navigation/primary-nav.ts`
- Modify: `apps/web/src/router.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles/pages/tasks-runtime.css`
- Modify: `apps/web/src/styles/pages/production-runtime.css`
- Modify: `apps/web/src/styles/pages/library.css`
- Modify: `tests/web-task-runtime.test.ts`
- Modify: `tests/web-planned-capabilities.test.ts`
- Modify: `tests/web-mobile-layout-contract.test.ts`

- [ ] **Step 1: Write failing source-contract tests**

Assert the primary nav labels are `AI/拆解/制作/模板/设置`, `/templates` is active, `/assets` is a compatibility alias, local upload invokes `analysis.importVideo`, and production/template delete controls have accessible labels and no fixture-backed data.

- [ ] **Step 2: Run red web tests**

Run: `pnpm exec tsx --test tests/web-task-runtime.test.ts tests/web-planned-capabilities.test.ts tests/web-mobile-layout-contract.test.ts`

Expected: FAIL because templates and controls are absent.

- [ ] **Step 3: Implement the pages**

Use existing `AppShell`, `GlassCard`, `Button`, `Icon`, `IssueNotice`, state panels, `TaskProgressSteps`, and `ContentAnalysisDocument`. Confirmation UI must name the target and require a second explicit button; no delete fires from a swipe or card-body click.

- [ ] **Step 4: Run green tests, typecheck, and Web build**

Run Step 2, `pnpm --filter @hongtai/web typecheck`, and `pnpm --filter @hongtai/web build`.

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

Exact-stage only the listed paths, run cached whitespace check, commit: `feat(web): activate video and template management`.

### Task 5: Live docs, full gates, and endpoint evidence

**Files:**
- Modify: `docs/当前能力与发布状态.md`
- Modify: `docs/架构与工程规范.md`
- Modify: `docs/前端显示板块对接清单.md`
- Create: `docs/acceptance/2026-08-12-video-workflow-management.md`

- [ ] **Step 1: Update live truth and acceptance checklist**

Record local upload, deletion, and templates as available only after runtime proof. Preserve Debug/QA versus physical-device/release boundaries and list any unavailable device evidence explicitly.

- [ ] **Step 2: Run complete verification**

Run:

```text
pnpm check
pnpm --filter @hongtai/web build
android/gradlew testDebugUnitTest lintDebug assembleDebug
git diff --check
UTF-8 and U+FFFD scan over changed source/docs
```

Expected: all exit 0; lint warnings are reported separately from errors.

- [ ] **Step 3: Browser endpoint test**

Start the production Web preview, inspect desktop and 390px widths, and exercise navigation, local-upload entry state, template create/edit/delete, and production delete confirmations with a controlled runtime harness. Save screenshots and console/network findings in the acceptance record.

- [ ] **Step 4: Android endpoint test**

Locate the configured Android SDK, run `adb devices -l`, install the APK built from current HEAD on the available device/emulator, exercise a real MP4 import and private deletion loop, then restart the app and verify persistence. If no device is available, record the exact blocker and do not claim device passage.

- [ ] **Step 5: Inspect artifact and commit docs**

Record APK path, package, version, signing class, byte size, and SHA-256. Exact-stage the four docs, check cached whitespace, commit: `docs(acceptance): record managed video workflow evidence`.

## Plan self-review

- Spec coverage: local upload, all required delete levels, custom templates, navigation migration, concurrency, Android I/O, docs, browser, and device evidence each map to a task.
- Placeholders: every step has an exact API, command, expected result, and bounded error behavior.
- Type consistency: service names are `AnalysisService.importVideo`, `TaskService.delete`, `ProductionService.removeAsset/removeOutput/delete`, and `TemplateService.createFromAnalysis/create/update/delete` throughout.
- Execution choice: inline execution is fixed by the user’s unattended instruction and the repository’s no-unrequested-subagent constraint.
