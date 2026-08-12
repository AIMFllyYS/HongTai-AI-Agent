# Android Lifecycle Interruption and Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every persisted Android workflow reaches an explicit interruption terminal after WebView/background execution loss, refresh live pages on foreground return, and preserve the current external-camera/Photo-Picker minimal-permission contract.

**Architecture:** Add one UI-safe recovery service to `AppRuntime`. Each existing standalone service remains authoritative for its own files and contributes idempotent inspect/recover operations; an internal operation registry distinguishes WebView-driven work from external Android activities. The official Capacitor App lifecycle event decides between a controlled WebView reload for unsafe in-process work and a lightweight persisted-state refresh for normal resumes.

**Tech Stack:** TypeScript, React 19, Capacitor 8 `@capacitor/app`, Kotlin/Android targetSdk 36, Node test runner, Gradle/JUnit.

---

## File map

### Create

- `packages/capacitor-runtime/src/runtime-operation-registry.ts`: in-memory activity registration with `in-process` versus `external-activity` execution modes.
- `packages/capacitor-runtime/src/runtime-operation-registry.test.ts`: registry identity, cleanup and duplicate-operation tests.
- `packages/capacitor-runtime/src/standalone-runtime-recovery.ts`: combines persisted recovery from the four existing services without owning a second state machine.
- `packages/capacitor-runtime/src/standalone-runtime-recovery.test.ts`: aggregation, deduplication and partial-failure behavior.
- `apps/web/src/runtime/app-lifecycle.ts`: pure coordinator for inactive→active transitions.
- `apps/web/src/hooks/useAppResume.ts`: shared hook for page-level persisted DTO refresh.
- `tests/web-app-lifecycle.test.ts`: lifecycle coordinator and source-wiring regression coverage.
- `docs/验收/2026-08-12-android-lifecycle-interruption.md`: implementation and endpoint evidence with explicit simulator/device boundary.

### Modify

- `packages/core/src/application-runtime.ts`: versioned recovery DTOs and `AppRuntime.recovery`.
- `packages/core/src/index.ts`: export the new public DTOs if the current barrel requires explicit export.
- `packages/capacitor-runtime/src/standalone-task-service.ts` and test: inspect/recover ingest tasks and register completion lifetime.
- `packages/capacitor-runtime/src/standalone-analysis-service.ts` and test: recover a running formal analysis as failed with `TASK_INTERRUPTED` and synchronize the task projection.
- `packages/capacitor-runtime/src/standalone-diagnosis-service.ts` and test: recover running reports and register report/chat/photo operations.
- `packages/capacitor-runtime/src/standalone-production-service.ts` and test: recover planning/rendering projects and register picker/planning/render operations.
- `packages/capacitor-runtime/src/standalone-app-runtime.ts` and test: compose the registry and recovery service; track inline profile/AI operations.
- `packages/capacitor-runtime/src/index.ts`: export only the composition APIs needed by the Web bootstrap.
- `apps/web/src/main.tsx`: install the lifecycle coordinator, perform pre-render cold-start recovery and dispatch the resume refresh event.
- `apps/web/src/pages/TaskProcessingPage.tsx`, `TaskHomePage.tsx`, `TaskDetailPage.tsx`, `TaskAnalysisPage.tsx`, `ObservationStartPage.tsx`, `ObservationReportPage.tsx`, and `CreatePage.tsx`: re-read safe DTOs on the shared resume event without remounting external photo flows.
- `apps/web/package.json`, `pnpm-lock.yaml`, `capacitor.config.ts`, generated Capacitor Android settings/plugin registry: add only official `@capacitor/app` v8.
- `tests/android-plugin-boundary.test.ts`: lock down the App plugin registration and no-dangerous-camera/gallery-permission contract.
- `tests/web-settings-runtime.test.ts` and `tests/web-task-runtime.test.ts`: replace one-time task-only recovery assertions with unified recovery and resume behavior.
- `docs/架构与工程规范.md`, `docs/项目整体架构方向.md`, `docs/当前能力与发布状态.md`, `docs/错误码与前端通知约定.md`: update the live lifecycle contract without claiming true background continuation.

## Task 1: Add the public recovery contract

**Files:**

- Modify: `packages/core/src/application-runtime.ts`
- Modify: `packages/core/src/index.ts`
- Test: `tests/application-runtime.test.ts`

- [ ] **Step 1: Write the failing contract test**

Add a compile/runtime assertion for the stable values and terminal projection:

```ts
import { RUNTIME_WORK_KIND_VALUES } from "@hongtai/core";

test("runtime recovery exposes every persisted workflow kind", () => {
  assert.deepEqual(RUNTIME_WORK_KIND_VALUES, [
    "ingest",
    "content-analysis",
    "diagnosis-report",
    "production-plan",
    "production-render",
    "transient-operation",
  ]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm exec tsx --test tests/application-runtime.test.ts
```

Expected: FAIL because `RUNTIME_WORK_KIND_VALUES` does not exist.

- [ ] **Step 3: Implement the minimal DTOs**

Add to `application-runtime.ts`:

```ts
export const RUNTIME_WORK_KIND_VALUES = [
  "ingest",
  "content-analysis",
  "diagnosis-report",
  "production-plan",
  "production-render",
  "transient-operation",
] as const;

export type RuntimeWorkKind = typeof RUNTIME_WORK_KIND_VALUES[number];
export type RuntimeWorkExecution = "in-process" | "external-activity";

export interface RuntimeUnfinishedWork {
  readonly kind: RuntimeWorkKind;
  readonly id: string;
  readonly source: "memory" | "persisted";
  readonly execution: RuntimeWorkExecution;
}

export interface RuntimeRecoveryProjection {
  readonly unfinished: readonly RuntimeUnfinishedWork[];
  readonly recovered: readonly RuntimeUnfinishedWork[];
}

export interface RuntimeRecoveryService {
  inspectUnfinishedWork(): Promise<readonly RuntimeUnfinishedWork[]>;
  recoverInterruptedWork(): Promise<RuntimeRecoveryProjection>;
}
```

Add `readonly recovery: RuntimeRecoveryService` to `AppRuntime`.

- [ ] **Step 4: Run the focused test and typecheck**

Run:

```powershell
pnpm exec tsx --test tests/application-runtime.test.ts
pnpm --filter @hongtai/core typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the contract phase**

Stage only the three Task 1 paths, run `git diff --cached --check`, then commit:

```powershell
git commit -m "feat(core): define runtime recovery contract"
```

## Task 2: Add the operation registry

**Files:**

- Create: `packages/capacitor-runtime/src/runtime-operation-registry.ts`
- Create: `packages/capacitor-runtime/src/runtime-operation-registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

Cover active lifetime, cleanup after rejection, and duplicate identity:

```ts
test("registry exposes an active in-process operation until it settles", async () => {
  const registry = new RuntimeOperationRegistry();
  let finish!: () => void;
  const pending = registry.track(
    { kind: "transient-operation", id: "probe:text", execution: "in-process" },
    () => new Promise<void>((resolve) => { finish = resolve; }),
  );

  assert.deepEqual(registry.list(), [{
    kind: "transient-operation",
    id: "probe:text",
    source: "memory",
    execution: "in-process",
  }]);
  finish();
  await pending;
  assert.deepEqual(registry.list(), []);
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm exec tsx --test packages/capacitor-runtime/src/runtime-operation-registry.test.ts
```

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the registry**

Use an identity key of `kind:id:execution`, a reference count for legitimate nested callers, immutable snapshots, and `try/finally` cleanup. Do not persist the registry and do not expose arbitrary metadata.

- [ ] **Step 4: Verify GREEN**

Run the focused registry test and `pnpm --filter @hongtai/capacitor-runtime typecheck`.

Expected: all pass.

## Task 3: Recover every persisted state source

**Files:**

- Modify: `packages/capacitor-runtime/src/standalone-task-service.ts`
- Modify: `packages/capacitor-runtime/src/standalone-task-service.test.ts`
- Modify: `packages/capacitor-runtime/src/standalone-analysis-service.ts`
- Modify: `packages/capacitor-runtime/src/standalone-analysis-service.test.ts`
- Modify: `packages/capacitor-runtime/src/standalone-diagnosis-service.ts`
- Modify: `packages/capacitor-runtime/src/standalone-diagnosis-service.test.ts`
- Modify: `packages/capacitor-runtime/src/standalone-production-service.ts`
- Modify: `packages/capacitor-runtime/src/standalone-production-service.test.ts`

- [ ] **Step 1: Write one failing recovery test per state source**

Each test must first persist a real running projection through the service's existing file port, then call the wished-for recovery API and assert:

```ts
assert.equal(recovered.issue?.code, "TASK_INTERRUPTED");
assert.equal(recovered.issue?.action, "retry");
assert.equal(recovered.status, "failed");
assert.equal(recoveredPreservedField, originalPreservedField);
```

For ingest assert `status === "interrupted"` and `action === "edit_input"`. For production write separate planning and rendering cases. Run all four focused test files and confirm they fail because the methods are missing.

- [ ] **Step 2: Add idempotency tests before implementation**

Call recovery twice and assert the second call returns no newly recovered item and does not duplicate `TASK_INTERRUPTED`.

- [ ] **Step 3: Implement service-local inspect/recover methods**

Use this stable issue shape outside ingest:

```ts
const interruptedIssue: TaskIssue = {
  code: "TASK_INTERRUPTED",
  severity: "warning",
  userMessage: "应用进入后台后本次执行未能可靠继续，已保留现有结果，请重新发起。",
  retryable: false,
  action: "retry",
};
```

Only each owning service writes its file. Keep the existing ingest issue/action. Analysis must update both `analysis.json` and the parent task's `analysisStatus` to `failed`.

- [ ] **Step 4: Register operation lifetimes**

Inject the shared registry into services and track:

- ingest completion: `in-process`;
- analysis run: `in-process`;
- diagnosis report and follow-up: `in-process`;
- diagnosis pick/capture: `external-activity`;
- production plan/render: `in-process`;
- production picker: `external-activity`.

Use real Promise lifetime, not button state or timer duration.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
pnpm --filter @hongtai/capacitor-runtime test
```

Expected: every existing and new runtime test passes.

- [ ] **Step 6: Commit the service recovery phase**

Precisely stage the registry and four service/test pairs, check staged whitespace, and commit:

```powershell
git commit -m "fix(runtime): recover interrupted standalone workflows"
```

## Task 4: Compose unified recovery

**Files:**

- Create: `packages/capacitor-runtime/src/standalone-runtime-recovery.ts`
- Create: `packages/capacitor-runtime/src/standalone-runtime-recovery.test.ts`
- Modify: `packages/capacitor-runtime/src/standalone-app-runtime.ts`
- Modify: `packages/capacitor-runtime/src/standalone-app-runtime.test.ts`
- Modify: `packages/capacitor-runtime/src/index.ts`

- [ ] **Step 1: Write failing aggregation tests**

Provide small service ports returning persisted work and a real operation registry returning memory work. Assert deterministic ordering and deduplication by `kind + id + source + execution`.

Add a failure-isolation test where diagnosis recovery rejects while task and production recovery still execute; the aggregate must reject only after all recovery ports were attempted, so bootstrap cannot silently present stale running data.

- [ ] **Step 2: Verify RED**

Run the new recovery test and confirm the module/API is absent.

- [ ] **Step 3: Implement `StandaloneRuntimeRecovery`**

The class may only call `inspectUnfinishedWork()` and `recoverInterruptedWork()` on existing services plus `registry.list()`. It must not read private files directly or infer status from UI copy.

- [ ] **Step 4: Compose it in `createStandaloneAppRuntime`**

Create one registry instance, pass it into every service, track inline profile avatar and AI probe operations, and return `recovery` on `AppRuntime`.

- [ ] **Step 5: Verify runtime tests and typecheck**

Run the complete Capacitor Runtime tests plus the root application-runtime test.

Expected: PASS with no warnings/errors.

## Task 5: Wire the official foreground/background signal

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `capacitor.config.ts`
- Create: `apps/web/src/runtime/app-lifecycle.ts`
- Modify: `apps/web/src/main.tsx`
- Test: `tests/web-app-lifecycle.test.ts`
- Test: `tests/web-settings-runtime.test.ts`

- [ ] **Step 1: Write failing lifecycle coordinator tests**

Test these exact branches with a fake state source:

```ts
test("inactive then active reloads when in-process work is unfinished", async () => {
  const harness = lifecycleHarness([{ kind: "ingest", id: "task-1", source: "persisted", execution: "in-process" }]);
  harness.emit(false);
  harness.emit(true);
  await harness.flush();
  assert.equal(harness.reloads, 1);
  assert.equal(harness.resumes, 0);
});

test("external activity return refreshes without reloading its WebView", async () => {
  const harness = lifecycleHarness([{ kind: "transient-operation", id: "photo", source: "memory", execution: "external-activity" }]);
  harness.emit(false);
  harness.emit(true);
  await harness.flush();
  assert.equal(harness.reloads, 0);
  assert.equal(harness.resumes, 1);
});
```

Also assert an initial `isActive=true` event does nothing and repeated active events are coalesced.

- [ ] **Step 2: Verify RED**

Run `pnpm exec tsx --test tests/web-app-lifecycle.test.ts` and observe the missing module failure.

- [ ] **Step 3: Add `@capacitor/app` v8 and sync**

Use the version matching Capacitor Core/Android (`8.0.0` unless the lockfile proves a newer aligned v8 already exists). Add it to the Web package, allowlist only that official plugin in `capacitor.config.ts`, and run:

```powershell
pnpm install --lockfile-only
pnpm exec cap sync android
```

Review every generated Android diff. Keep custom native plugins explicitly registered and do not expose unrelated plugins.

- [ ] **Step 4: Implement the pure coordinator**

The coordinator receives four injected functions: subscribe to app state, inspect recovery, reload, and notify resume. It tracks a real inactive→active edge and serializes overlapping resume checks.

- [ ] **Step 5: Wire bootstrap**

Before setting `runtime`, call `runtime.recovery.recoverInterruptedWork()`. After runtime creation, bind Capacitor App's `appStateChange`. For safe refresh dispatch:

```ts
window.dispatchEvent(new Event("hongtai:app-resumed"));
```

For unsafe in-process work use `window.location.reload()`; do not directly mutate task files from React.

- [ ] **Step 6: Verify lifecycle tests, typecheck and Web build**

Run the focused tests, `pnpm --filter @hongtai/web typecheck`, and the Web production build.

Expected: PASS; only the repository's already documented chunk-size warning may remain.

- [ ] **Step 7: Commit the lifecycle wiring phase**

Precisely stage package/config/generated/lifecycle/bootstrap/test paths and commit:

```powershell
git commit -m "fix(android): reconcile work after app background"
```

## Task 6: Refresh live pages without breaking external Activities

**Files:**

- Create: `apps/web/src/hooks/useAppResume.ts`
- Modify: the seven live pages listed in the file map
- Test: `tests/web-task-runtime.test.ts`
- Test: `tests/web-observation-runtime.test.ts`
- Test: `tests/web-app-lifecycle.test.ts`

- [ ] **Step 1: Write failing page wiring tests**

Assert live pages use the shared hook and do not import `@capacitor/app` directly. Add a jsdom-free source contract that verifies the hook registers and removes the exact `hongtai:app-resumed` listener, while the pure coordinator behavior remains covered in `tests/web-app-lifecycle.test.ts`.

- [ ] **Step 2: Verify RED**

Run the three focused Web tests and confirm missing hook/wiring failures.

- [ ] **Step 3: Implement the hook**

```ts
export function useAppResume(callback: () => void | Promise<void>): void {
  const current = useRef(callback);
  current.current = callback;
  useEffect(() => {
    const handle = () => { void current.current(); };
    window.addEventListener("hongtai:app-resumed", handle);
    return () => window.removeEventListener("hongtai:app-resumed", handle);
  }, []);
}
```

Use stable `useCallback` loaders. Do not reset selected images or remount the observation start page merely because the system camera returned.

- [ ] **Step 4: Verify GREEN and build**

Run focused tests, Web typecheck and Web build.

- [ ] **Step 5: Commit the page refresh phase**

Commit only the hook, page and test files:

```powershell
git commit -m "fix(web): refresh persisted state on app resume"
```

## Task 7: Lock the minimal Android permission contract

**Files:**

- Modify: `tests/android-plugin-boundary.test.ts`
- Modify only if sync requires it: `android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Write the permission boundary assertions**

Extend the camera test:

```ts
for (const permission of [
  "android.permission.CAMERA",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.MANAGE_EXTERNAL_STORAGE",
]) {
  assert.doesNotMatch(manifest, new RegExp(permission.replaceAll(".", "\\.")));
}
assert.match(fileMedia, /MediaStore\.ACTION_IMAGE_CAPTURE/);
assert.match(fileMedia, /FLAG_GRANT_READ_URI_PERMISSION or Intent\.FLAG_GRANT_WRITE_URI_PERMISSION/);
```

Also assert the `FileProvider` is `exported="false"` and grants URI permissions.

- [ ] **Step 2: Run the test**

This is a characterization test and may pass immediately because the desired minimal-permission behavior already exists. Record that it locks existing correct behavior rather than claiming a new permission implementation.

- [ ] **Step 3: Inspect the merged Manifest**

After Capacitor sync/build, use the generated manifest report or APK analyzer/aapt output to confirm no dependency reintroduced dangerous camera/gallery permissions.

## Task 8: Update live docs and acceptance evidence

**Files:**

- Modify: `docs/架构与工程规范.md`
- Modify: `docs/项目整体架构方向.md`
- Modify: `docs/当前能力与发布状态.md`
- Modify: `docs/错误码与前端通知约定.md`
- Create: `docs/验收/2026-08-12-android-lifecycle-interruption.md`

- [ ] **Step 1: Update current contracts**

State that background continuation is still not promised, but cold start and foreground return now reconcile every persisted workflow. Document the exact status mapping and preserved-artifact rule.

- [ ] **Step 2: Document permission truth**

Explain why the system settings page has no camera/gallery dangerous-permission block for the current external camera and Photo Picker path. Separate the future CameraX permission workflow.

- [ ] **Step 3: Write acceptance evidence**

Record exact commands, counts, APK identity/hash and available endpoint scope. Keep emulator, physical device, Debug/QA and release evidence separate.

- [ ] **Step 4: Validate and commit docs**

Scan changed text for U+FFFD, validate Markdown links, run `git diff --cached --check`, and commit:

```powershell
git commit -m "docs(android): record lifecycle recovery boundary"
```

## Task 9: Full verification and endpoint checks

**Files:**

- Verification only; update the acceptance document only with fresh evidence.

- [ ] **Step 1: Run TypeScript and Web gates**

```powershell
pnpm check
pnpm --filter @hongtai/web build
```

- [ ] **Step 2: Run Android gates with JDK 21 and the installed SDK**

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "C:\Users\AIMFl\AppData\Local\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
Push-Location android
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --no-daemon --console=plain
Pop-Location
```

- [ ] **Step 3: Inspect APK permissions and identity**

Use `apkanalyzer` or `aapt2 dump permissions`, `apksigner verify --print-certs`, and `Get-FileHash -Algorithm SHA256`. Confirm package name/version, Debug signing boundary, `INTERNET`, and absence of camera/gallery dangerous permissions.

- [ ] **Step 4: Run an isolated emulator if available**

Use an existing named AVD without deleting or overwriting user data. Install the Debug APK and exercise Home/background/return and `am kill` cases with a controlled local fixture or pre-created running state. Capture logcat/status files without secrets or private paths.

- [ ] **Step 5: State the physical-device boundary**

If `adb devices -l` contains no physical device, explicitly report that OEM battery management, real camera, Photo Picker and physical background behavior remain unverified. Do not convert emulator evidence into a physical-device claim.

- [ ] **Step 6: Final integrity checks**

```powershell
git diff --check
git status --short --branch
```

Scan all changed source/docs/JSON files for U+FFFD. Confirm `HongTai.zip` remains untouched and untracked. Do not push.

## Plan self-review

- Every design requirement maps to Tasks 1–9.
- The plan keeps true foreground-service/background execution out of this repair and records it as a separate architecture evolution.
- Test-first steps precede every production-code behavior change; the permission assertion is explicitly identified as a characterization test of already-correct behavior.
- File ownership remains aligned with `React → AppRuntime → shared Flow → Android I/O`; no Kotlin business state machine is introduced.
- Commands use exact paths, JDK 21 and the known Android SDK; commits are local and path-scoped.
