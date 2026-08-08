# Minimal Standalone APK Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a buildable standalone Android APK whose React UI drives the existing TypeScript ingestion, analysis, and observation flows through only the Android I/O they require.

**Architecture:** Keep `IngestPipeline`, `ContentAnalysisFlow`, `DiagnosisFlow`, and platform adapters as the sole business logic. Replace the duplicate Capacitor runner and SQLCipher task stores with a small private-file task store and explicit Android plugin ports. The UI consumes `AppRuntime` DTOs and never parses console text or reads native storage directly.

**Tech Stack:** React/TypeScript/Vite, Capacitor Android, Kotlin, Android Keystore, Photo Picker, private app files, existing Zod/OpenAI-compatible flows.

---

### Task 1: Freeze the minimal delivery contract

**Files:**
- Modify: `docs/架构与工程规范.md`
- Modify: `docs/错误码与前端通知约定.md`
- Modify: `README.md`
- Test: `tests/architecture-minimal-runtime.test.ts`

- [ ] **Step 1: Write the failing contract test**

```ts
test("minimum APK contract forbids a duplicate ingest runner and SQLCipher task stores", () => {
  const architecture = readFileSync("docs/架构与工程规范.md", "utf8");
  assert.match(architecture, /既有.*IngestPipeline.*唯一/);
  assert.match(architecture, /不实现 SQLCipher.*任务/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm exec tsx --test tests/architecture-minimal-runtime.test.ts`

Expected: FAIL until the global contract is replaced.

- [ ] **Step 3: Replace production-scale storage/recovery requirements with the approved private-file delivery profile**

Update the global architecture document so `ThinAppRuntime`, private task files, a single event log, Keystore-only secrets, and explicit `interrupted` handling are the contract. Remove SQLCipher task tables, duplicate runner, mandatory foreground recovery, and production-only probe requirements.

- [ ] **Step 4: Run the focused documentation test**

Run: `pnpm exec tsx --test tests/architecture-minimal-runtime.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/架构与工程规范.md docs/错误码与前端通知约定.md README.md docs/superpowers/specs/2026-08-07-minimal-standalone-apk-integration-design.md docs/superpowers/plans/2026-08-07-minimal-standalone-apk-integration.md tests/architecture-minimal-runtime.test.ts
git diff --cached --check
git commit -m "docs(architecture): simplify standalone APK delivery contract"
```

### Task 2: Make the existing ingestion pipeline runnable through Android ports

**Files:**
- Delete: `packages/capacitor-runtime/src/capacitor-ingest-runner.ts`
- Create: `packages/capacitor-runtime/src/android-ingest-dependencies.ts`
- Create: `packages/capacitor-runtime/src/private-task-store.ts`
- Modify: `packages/capacitor-runtime/src/task-service.ts`
- Modify: `packages/capacitor-runtime/src/bridge.ts`
- Modify: `android/app/src/main/java/com/hongtai/aiagent/bridge/NativeNetworkPlugin.kt`
- Modify: `android/app/src/main/java/com/hongtai/aiagent/bridge/FileMediaPlugin.kt`
- Test: `packages/capacitor-runtime/src/android-ingest-dependencies.test.ts`
- Test: `packages/capacitor-runtime/src/private-task-store.test.ts`

- [ ] **Step 1: Write failing tests for task snapshot/event persistence and dependency wiring**

```ts
test("appendEvent persists before listeners receive an existing pipeline event", async () => {
  const store = createMemoryPrivateTaskStore();
  const events: string[] = [];
  store.subscribe("task-1", (event) => events.push(event.message));
  await store.appendEvent(eventFor("task-1", 1, "detect-platform"));
  assert.deepEqual(await store.readEvents("task-1"), [eventFor("task-1", 1, "detect-platform")]);
  assert.deepEqual(events, ["识别平台"]);
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm --filter @hongtai/capacitor-runtime test -- android-ingest-dependencies private-task-store`

Expected: FAIL because the thin store/dependency adapter does not exist.

- [ ] **Step 3: Implement only the pipeline ports and private-file store**

Build `AndroidIngestDependencies` from the existing `HttpClient`, downloader, media and artifact interfaces. Make its progress callback append existing Pipeline events to `events.jsonl`; do not create stages. The Kotlin plugins expose named methods for request, download, private-file write/read and selected-media import; they do not persist task state or interpret platform data.

- [ ] **Step 4: Replace the duplicate runner**

Make `TaskService.create` instantiate the existing `IngestPipeline` with `AndroidIngestDependencies`. Delete `capacitor-ingest-runner.ts` and remove all imports/references. A process-start scan changes only unfinished file snapshots to `interrupted`.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm --filter @hongtai/capacitor-runtime test && pnpm --filter @hongtai/capacitor-runtime typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/capacitor-runtime android/app/src/main/java/com/hongtai/aiagent/bridge/NativeNetworkPlugin.kt android/app/src/main/java/com/hongtai/aiagent/bridge/FileMediaPlugin.kt
git diff --cached --check
git commit -m "refactor(runtime): run existing ingest pipeline in APK"
```

### Task 3: Connect real task, result, and analysis screens

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/router.ts`
- Create/Modify: `apps/web/src/pages/TaskHomePage.tsx`
- Create/Modify: `apps/web/src/pages/TaskProcessingPage.tsx`
- Create/Modify: `apps/web/src/pages/TaskDetailPage.tsx`
- Create/Modify: `apps/web/src/pages/TaskAnalysisPage.tsx`
- Create/Modify: `apps/web/src/features/tasks/task-presenters.ts`
- Test: `tests/web-task-runtime.test.ts`

- [ ] **Step 1: Write failing UI-controller tests**

```ts
test("task home submits raw share text through runtime and navigates with its returned task id", async () => {
  const runtime = fakeRuntime({ createTask: { taskId: "t-1" } });
  const page = createTaskHomeController(runtime);
  await page.submit("复制打开抖音 https://example.test/v/1");
  assert.equal(page.navigationTarget, "/tasks/t-1/processing");
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm exec tsx --test tests/web-task-runtime.test.ts`

Expected: FAIL until the page uses the thin runtime contract.

- [ ] **Step 3: Map existing DTOs to the existing page shell**

Use `inspectInput`, task events, task snapshots and artifacts. Show only real fields, correct empty states, the seven existing stages, and a user-confirmed analysis action. Keep planned pages disabled through one reusable unavailable component.

- [ ] **Step 4: Run focused tests, web typecheck, and build**

Run: `pnpm exec tsx --test tests/web-task-runtime.test.ts && pnpm --filter @hongtai/web typecheck && pnpm --filter @hongtai/web build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src tests/web-task-runtime.test.ts
git diff --cached --check
git commit -m "feat(tasks): connect real APK task and analysis screens"
```

### Task 4: Connect settings and observation without a second persistence system

**Files:**
- Modify: `packages/capacitor-runtime/src/app-runtime.ts`
- Modify: `packages/capacitor-runtime/src/capacitor-ai-transport.ts`
- Modify: `packages/capacitor-runtime/src/capacitor-diagnosis-service.ts`
- Modify: `apps/web/src/pages/AiSettingsPage.tsx`
- Modify: `apps/web/src/pages/ObservationStartPage.tsx`
- Modify: `apps/web/src/pages/ObservationReportPage.tsx`
- Modify: `android/app/src/main/java/com/hongtai/aiagent/bridge/SecureSettingsPlugin.kt`
- Modify: `android/app/src/main/java/com/hongtai/aiagent/bridge/FileMediaPlugin.kt`
- Test: `packages/capacitor-runtime/src/capacitor-diagnosis-service.test.ts`
- Test: `tests/web-observation-runtime.test.ts`

- [ ] **Step 1: Write failing tests for secret visibility and one-mode observation**

```ts
test("saving settings exposes configured state but never the API key", async () => {
  const settings = createRuntimeSettings(fakeNativeSettings());
  await settings.replaceApiKey("secret-value");
  assert.deepEqual(await settings.getPublic(), { apiKeyConfigured: true });
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm --filter @hongtai/capacitor-runtime test -- capacitor-diagnosis-service && pnpm exec tsx --test tests/web-observation-runtime.test.ts`

Expected: FAIL until the thin private-file services replace SQLCipher store dependencies.

- [ ] **Step 3: Implement minimal settings and observation adapters**

Keep public settings in private preferences, key material in `SecureSettingsPlugin`, and observation session/report/message JSON in a session directory. Import one selected image into private files, run the existing `DiagnosisFlow`, and render its report/follow-up stream without changing medical policy.

- [ ] **Step 4: Run focused tests and typechecks**

Run: `pnpm --filter @hongtai/capacitor-runtime test && pnpm --filter @hongtai/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/capacitor-runtime apps/web/src android/app/src/main/java/com/hongtai/aiagent/bridge/SecureSettingsPlugin.kt android/app/src/main/java/com/hongtai/aiagent/bridge/FileMediaPlugin.kt
git diff --cached --check
git commit -m "feat(diagnosis): connect APK settings and observation flow"
```

### Task 5: Build and verify the delivery APK

**Files:**
- Create: `docs/验收/2026-08-07-minimal-apk-delivery.md`
- Modify: `README.md`
- Test: `tests/apk-runtime-boundary.test.ts`

- [ ] **Step 1: Write a failing APK-boundary test**

```ts
test("APK entry does not load .env or Node runtime modules", () => {
  const entry = readFileSync("apps/web/src/main.tsx", "utf8");
  assert.doesNotMatch(entry, /node:|\.env|@hongtai\/node-runtime/);
});
```

- [ ] **Step 2: Run all relevant automated checks**

Run: `pnpm check && pnpm --filter @hongtai/web build && .\\android\\gradlew.bat :app:testDebugUnitTest :app:assembleDebug`

Expected: PASS and a debug APK under `android/app/build/outputs/apk/debug/`.

- [ ] **Step 3: Verify package and UTF-8/sensitive boundaries**

Run: `git diff --check && rg -n "\uFFFD|API_KEY=|OPENAI_API_KEY=" apps packages android docs`

Expected: no malformed UTF-8 replacement character and no embedded secret assignment.

- [ ] **Step 4: Record factual build evidence**

Record APK path, SHA-256, version, checks run, and the distinction between build evidence and any unavailable physical-device evidence.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/验收/2026-08-07-minimal-apk-delivery.md tests/apk-runtime-boundary.test.ts
git diff --cached --check
git commit -m "test(android): verify minimal standalone APK delivery"
```
