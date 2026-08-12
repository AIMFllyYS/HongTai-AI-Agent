# Single-Stream Reasoning Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace five serial AI calls with one reasoning-visible structured stream for diagnosis and content analysis, keep five validated UI sections, and stop Android media-picker returns from reloading the live WebView.

**Architecture:** `packages/ai` remains the only owner of provider dialects, prompts, stream parsing, Zod validation, and final document assembly. `packages/core` exposes one optional runtime-only thinking snapshot, `packages/capacitor-runtime` replays the existing active snapshot, and `apps/web` renders plain-text reasoning plus already-validated sections. Persisted reports and task documents remain unchanged.

**Tech Stack:** TypeScript, Zod, React, Capacitor 8, Node test runner through `tsx --test`, pnpm, Android Gradle.

---

## File map

### Create

- `packages/ai/src/structured-output/top-level-json-field-stream.ts`: bounded state machine that emits complete top-level JSON values.
- `packages/ai/src/structured-output/reasoning-progress.ts`: coalesces raw reasoning into runtime-only progress snapshots for two real flows.
- `packages/ai/src/prompts/diagnosis-report-single.ts`: one diagnosis generation Prompt and one whole-document repair Prompt.
- `packages/ai/src/prompts/content-analysis-single.ts`: one content-analysis generation Prompt and one whole-document repair Prompt.
- `apps/web/src/components/DeepThinkingPanel.tsx`: shared plain-text disclosure for runtime reasoning.
- Focused tests only if an existing test file cannot own the behavior without mixing domains.

### Modify

- `apps/web/src/runtime/app-lifecycle.ts`, `apps/web/src/main.tsx`, `tests/web-app-lifecycle.test.ts`: resume without controlled reload.
- `packages/ai/src/contracts/provider.ts`, `packages/ai/src/providers/openai-compatible-provider.ts`, `packages/ai/src/node.ts`, `packages/node-runtime/src/config.ts`, `packages/capacitor-runtime/src/standalone-app-runtime.ts`: provider dialect and token-limit mapping.
- `packages/core/src/application-runtime.ts`: optional `thinking` snapshot on existing progress v1.
- `packages/ai/src/structured-output/structured-generation-progress.ts`: thinking state and one-stream section transitions.
- `packages/ai/src/schemas/diagnosis-report.ts`, `packages/ai/src/schemas/content-analysis.ts`: compact model response schemas while preserving formal v1 schemas.
- `packages/ai/src/flows/diagnosis/diagnosis-flow.ts`, `packages/ai/src/flows/content-analysis/content-analysis-flow.ts`: one normal call and at most one whole-document repair.
- `packages/capacitor-runtime/src/standalone-diagnosis-service.ts`, `packages/capacitor-runtime/src/standalone-analysis-service.ts`: forward and replay progress containing thinking without persistence.
- `apps/web/src/components/ValidatedModuleProgress.tsx`, related generation CSS and pages: reasoning panel and corrected copy.
- `apps/web/src/styles/components.css`, `apps/web/src/styles/pages/observation-runtime.css`: targeted busy-primary appearance.
- Existing tests under `tests/` and `packages/capacitor-runtime/src/*.test.ts`.
- Live docs, CHANGELOG, Android version/build checks, and v0.1.6 acceptance record.

### Delete after replacement is green

- Five diagnosis initial-generation Prompt files and five content-analysis initial-generation Prompt files that have no remaining caller.
- Per-module repair orchestration and tests that require exactly five provider calls.
- Copy that says reasoning is never visible or five remote calls are a permanent architecture rule.

## Task 1: Keep the live WebView across media-picker return

**Files:**
- Modify: `tests/web-app-lifecycle.test.ts`
- Modify: `apps/web/src/runtime/app-lifecycle.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `packages/capacitor-runtime/src/standalone-task-service.test.ts`

- [ ] **Step 1: Write the failing lifecycle regression test**

Replace the old “in-process work reloads on resume” expectation with the actual contract:

```ts
test("inactive then active never reloads a still-live WebView", async () => {
  const subject = harness(async () => [
    { kind: "ingest", id: "task-local", source: "persisted", execution: "in-process" },
  ]);
  const installed = await subject.install();
  subject.emit(false);
  subject.emit(true);
  await installed.whenIdle();
  assert.deepEqual(subject.counts(), { reloads: 0, resumes: 1, removals: 0 });
});
```

Add a second test whose inspection throws and assert `reloads: 0, resumes: 1`; storage-read failure cannot destroy a live callback.

- [ ] **Step 2: Run the lifecycle test and verify RED**

Run:

```powershell
pnpm exec tsx --test tests/web-app-lifecycle.test.ts
```

Expected: the new assertions fail because `reconcile()` currently calls `options.reload()`.

- [ ] **Step 3: Implement the minimum lifecycle fix**

Reduce resume reconciliation to a notification. Remove `inspectUnfinishedWork` and `reload` from the coordinator options if they become unused:

```ts
const reconcile = async (): Promise<void> => {
  options.notifyResume();
};
```

Keep `runtime.recovery.recoverInterruptedWork()` at cold bootstrap in `main.tsx`; it is the correct boundary for an actually rebuilt WebView.

- [ ] **Step 4: Add the picker-return integration assertion**

Extend the local-video task test so the task returned from `importVideo()` remains `queued`, `recoverInterruptedWork()` is not called as part of ordinary resume, and `start()` can reach `succeeded`. The assertion must cover another pre-existing task remaining unchanged.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```powershell
pnpm exec tsx --test tests/web-app-lifecycle.test.ts
pnpm --filter @hongtai/capacitor-runtime test
git diff --check
```

Commit only the lifecycle paths:

```powershell
git add -- apps/web/src/runtime/app-lifecycle.ts apps/web/src/main.tsx tests/web-app-lifecycle.test.ts packages/capacitor-runtime/src/standalone-task-service.test.ts
git commit -m "fix(runtime): keep media imports alive across picker return"
```

## Task 2: Match Xiaomi and StepFun reasoning protocols

**Files:**
- Modify: `packages/ai/src/contracts/provider.ts`
- Modify: `packages/ai/src/providers/openai-compatible-provider.ts`
- Modify: `packages/ai/src/node.ts`
- Modify: `packages/node-runtime/src/config.ts`
- Modify: `packages/capacitor-runtime/src/standalone-app-runtime.ts`
- Modify: `tests/ai-provider.test.ts`

- [ ] **Step 1: Write failing provider request tests**

Add a request-level contract:

```ts
export type AiReasoningDialect = "xiaomi-mimo" | "stepfun" | "generic";

export interface AiGenerateRequest {
  // existing fields
  readonly maxOutputTokens?: number;
}
```

Test the serialized request body:

```ts
assert.deepEqual(xiaomiBody.thinking, { type: "enabled" });
assert.equal(xiaomiBody.max_completion_tokens, 2048);
assert.equal(stepfunBody.reasoning_format, "general");
assert.equal(stepfunBody.max_tokens, 2048);
assert.equal("reasoning_effort" in stepfunBody, false);
```

Also assert Xiaomi prefers `reasoning_content` and StepFun prefers `reasoning`, while both fall back to the other field.

- [ ] **Step 2: Run provider tests and verify RED**

```powershell
pnpm exec tsx --test tests/ai-provider.test.ts
```

Expected: request-body assertions fail because the current body sends no vendor reasoning fields or output limit.

- [ ] **Step 3: Implement the dialect mapping**

Replace unused `reasoningMode: "provider-default"` with `reasoningDialect`. The Provider body extension is deliberately small:

```ts
const reasoningBody = this.#config.reasoningDialect === "xiaomi-mimo"
  ? { thinking: { type: "enabled" } }
  : this.#config.reasoningDialect === "stepfun"
    ? { reasoning_format: "general" }
    : {};

const tokenLimitBody = request.maxOutputTokens == null
  ? {}
  : this.#config.reasoningDialect === "xiaomi-mimo"
    ? { max_completion_tokens: request.maxOutputTokens }
    : { max_tokens: request.maxOutputTokens };
```

Use the exact preset Base URLs to select the dialect in Node and Capacitor construction; unknown advanced URLs use `generic` and receive no vendor-specific reasoning field.

- [ ] **Step 4: Verify provider tests and affected typechecks**

```powershell
pnpm exec tsx --test tests/ai-provider.test.ts
pnpm --filter @hongtai/ai typecheck
pnpm --filter @hongtai/capacitor-runtime typecheck
```

Expected: all commands exit 0.

## Task 3: Add runtime-only reasoning progress and the top-level JSON parser

**Files:**
- Create: `packages/ai/src/structured-output/top-level-json-field-stream.ts`
- Create: `packages/ai/src/structured-output/reasoning-progress.ts`
- Modify: `packages/core/src/application-runtime.ts`
- Modify: `packages/ai/src/structured-output/structured-generation-progress.ts`
- Modify: `tests/structured-generation-progress.test.ts` or the nearest existing structured-output test

- [ ] **Step 1: Write failing JSON stream tests**

Define the wished-for API:

```ts
const parser = new TopLevelJsonFieldStream(["overview", "styleTemplate"]);
const emitted = [
  ...parser.push('{"over'),
  ...parser.push('view":{"text":"中'),
  ...parser.push('文\\\"内容"},"styleTemplate":{"steps":["A",{"x":1}]}}'),
  ...parser.finish(),
];
assert.deepEqual(emitted, [
  { key: "overview", value: { text: '中文"内容' } },
  { key: "styleTemplate", value: { steps: ["A", { x: 1 }] } },
]);
```

Add cases for field names across chunks, braces inside strings, escaped backslashes, arrays, unknown fields, duplicate fields, truncated input, and multibyte Chinese chunks.

- [ ] **Step 2: Run and verify parser RED**

```powershell
pnpm exec tsx --test tests/structured-generation-progress.test.ts
```

Expected: import or constructor failure because the parser does not exist.

- [ ] **Step 3: Implement only the top-level state machine**

The parser accumulates source, tracks `inString`, `escaped`, nesting depth, current key, and value start. It calls `JSON.parse` only after a top-level value closes. It never repairs or exposes partial values.

- [ ] **Step 4: Write failing thinking snapshot tests**

Extend the existing progress DTO with:

```ts
export interface StructuredGenerationThinkingV1 {
  readonly status: "waiting" | "streaming" | "completed";
  readonly text: string;
}
```

Test waiting, delta accumulation, final flush, route-snapshot suitability, and a bounded coalescing policy that does not emit on every one-character delta.

- [ ] **Step 5: Implement the reasoning collector and verify GREEN**

`ReasoningProgress` appends raw text, requests progress emission at a deterministic character/time boundary, and always flushes at content start, completion, repair, or failure. It has two callers only: diagnosis and content analysis.

Run:

```powershell
pnpm exec tsx --test tests/structured-generation-progress.test.ts
pnpm --filter @hongtai/core typecheck
pnpm --filter @hongtai/ai typecheck
```

Expected: all commands exit 0.

## Task 4: Collapse diagnosis to one structured stream

**Files:**
- Create: `packages/ai/src/prompts/diagnosis-report-single.ts`
- Modify: `packages/ai/src/schemas/diagnosis-report.ts`
- Modify: `packages/ai/src/flows/diagnosis/diagnosis-flow.ts`
- Modify: `tests/diagnosis-flow.test.ts`

- [ ] **Step 1: Replace five-call assertions with a failing one-call contract**

The main test must assert:

```ts
assert.equal(provider.calls.length, 1);
assert.equal(provider.calls[0]?.model, "vision");
assert.equal(countImageParts(provider.calls[0]!), 1);
assert.equal(provider.calls[0]?.maxOutputTokens, 2048);
assert.deepEqual(progress.modules.map((module) => module.status), [
  "succeeded", "succeeded", "succeeded", "succeeded", "succeeded",
]);
```

Send reasoning chunks before content chunks and assert the activity progress contains the exact cumulative text but the persisted report/run record does not.

- [ ] **Step 2: Run diagnosis tests and verify RED**

```powershell
pnpm exec tsx --test tests/diagnosis-flow.test.ts
```

Expected: provider call count remains 5 and the compact schema is absent.

- [ ] **Step 3: Add the compact model schema and local assembly**

Model response:

```ts
const diagnosisSingleResponseSchema = z.object({
  quality: z.enum(["good", "limited", "unusable"]),
  observation: z.string().max(2000),
  summary: z.string().max(2000),
  advice: z.string().max(2000),
  safety: z.string().min(1).max(2000),
  followUp: z.string().max(500),
});
```

The local assembler injects `diagnosis-single-stream.v1`, mode, stable IDs, fixed disclaimer and permitted categories, then validates `diagnosisReportSchema`. Existing report versions remain accepted.

- [ ] **Step 4: Implement one call and one whole-document repair**

One Provider request owns reasoning and content callbacks. The top-level parser validates completed diagnosis sections. If final parse/semantics fail, run one repair request over the compact response; never start a third request.

- [ ] **Step 5: Verify diagnosis GREEN**

```powershell
pnpm exec tsx --test tests/diagnosis-flow.test.ts
pnpm --filter @hongtai/ai typecheck
```

Expected: normal path one call, repair path two calls, all old-report compatibility tests pass.

## Task 5: Collapse content analysis to one structured stream

**Files:**
- Create: `packages/ai/src/prompts/content-analysis-single.ts`
- Modify: `packages/ai/src/schemas/content-analysis.ts`
- Modify: `packages/ai/src/flows/content-analysis/content-analysis-flow.ts`
- Modify: `tests/content-analysis-flow.test.ts`

- [ ] **Step 1: Write the failing one-call evidence contract**

```ts
assert.equal(provider.calls.length, 1);
const prompt = JSON.stringify(provider.calls[0]?.messages);
assert.equal(occurrences(prompt, "segment-0"), 1);
assert.equal(provider.calls[0]?.maxOutputTokens, 4096);
```

Assert each emitted module uses only valid evidence IDs, while `source` is injected locally and absent from the model response.

- [ ] **Step 2: Run content-analysis tests and verify RED**

```powershell
pnpm exec tsx --test tests/content-analysis-flow.test.ts
```

Expected: five provider calls and repeated evidence remain.

- [ ] **Step 3: Implement the grouped single-response schema**

The model returns exactly these top-level keys:

```ts
const contentAnalysisSingleResponseSchema = z.object({
  overview: contentAnalysisOverviewSchema,
  hookDrivers: contentAnalysisHookDriversSchema,
  structureClaims: contentAnalysisStructureClaimsSchema,
  styleTemplate: contentAnalysisStyleTemplateSchema,
  risksBoundaries: contentAnalysisRisksBoundariesSchema,
});
```

The local assembler flattens the five groups and injects the existing source into `content-analysis.v1`.

- [ ] **Step 4: Implement one call, section validation, and one repair**

Feed complete top-level group values into their existing Zod and evidence-ref validation. Emit only validated results. Final full validation and save remain unchanged.

- [ ] **Step 5: Verify content-analysis GREEN and commit the AI phase**

```powershell
pnpm exec tsx --test tests/ai-provider.test.ts tests/structured-generation-progress.test.ts tests/diagnosis-flow.test.ts tests/content-analysis-flow.test.ts
pnpm --filter @hongtai/ai typecheck
git diff --check
```

Stage only AI/core/provider paths and commit:

```powershell
git add -- packages/ai packages/core/src/application-runtime.ts packages/node-runtime/src/config.ts packages/capacitor-runtime/src/standalone-app-runtime.ts tests/ai-provider.test.ts tests/structured-generation-progress.test.ts tests/diagnosis-flow.test.ts tests/content-analysis-flow.test.ts
git commit -m "refactor(ai): generate reports in one reasoning stream"
```

## Task 6: Replay reasoning through Runtime without persistence

**Files:**
- Modify: `packages/capacitor-runtime/src/standalone-analysis-service.ts`
- Modify: `packages/capacitor-runtime/src/standalone-diagnosis-service.ts`
- Modify: `packages/capacitor-runtime/src/standalone-analysis-service.test.ts`
- Modify: `packages/capacitor-runtime/src/standalone-diagnosis-service.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Assert a late subscriber immediately receives a progress snapshot containing accumulated thinking, and terminal completion clears the activity snapshot. Recursively inspect every persisted write and assert it contains neither the reasoning fixture nor `thinking`.

- [ ] **Step 2: Run and verify RED**

```powershell
pnpm --filter @hongtai/capacitor-runtime test
```

Expected: reasoning is currently discarded from the public progress path.

- [ ] **Step 3: Implement thin forwarding only**

Do not parse deltas in Runtime. Store the latest `StructuredGenerationProgressV1` generated by the Flow, replay it to subscribers, persist only the final formal document, and clear on terminal events.

- [ ] **Step 4: Verify GREEN**

```powershell
pnpm --filter @hongtai/capacitor-runtime test
pnpm --filter @hongtai/capacitor-runtime typecheck
```

Expected: all tests pass and persistence scans stay clean.

## Task 7: Render the shared deep-thinking panel and busy buttons

**Files:**
- Create: `apps/web/src/components/DeepThinkingPanel.tsx`
- Modify: `apps/web/src/components/ValidatedModuleProgress.tsx`
- Modify: generation CSS and `apps/web/src/styles/components.css`
- Modify: `apps/web/src/styles/pages/observation-runtime.css`
- Modify: pages containing old no-reasoning copy
- Modify: relevant Web tests

- [ ] **Step 1: Write failing component/source contract tests**

Assert:

- the panel renders heading `深度思考`;
- waiting text appears before the first delta;
- raw text is rendered as text, never Markdown/HTML;
- streaming is expanded;
- transition to completed collapses automatically;
- user can reopen completed reasoning;
- `aria-live` does not read every text delta;
- no old “不展示供应商 reasoning” copy remains;
- busy diagnosis/video buttons retain `disabled` and `aria-busy` but use the targeted green/black class.

- [ ] **Step 2: Run Web tests and verify RED**

```powershell
pnpm exec tsx --test tests/web-structured-generation-progress.test.ts tests/web-observation-pages.test.ts tests/web-task-pages.test.ts
```

Expected: component and copy assertions fail.

- [ ] **Step 3: Implement the minimal shared component**

Use native `<details>` semantics or an equivalent button with `aria-expanded`; render reasoning in a `<pre>`/plain-text container. Never use `dangerouslySetInnerHTML` or a Markdown renderer.

- [ ] **Step 4: Implement targeted busy styling**

```css
.button--busy-primary:disabled {
  color: #000;
  background: linear-gradient(135deg, #80d5be, #55b69f);
  opacity: 1;
}
```

Apply it only to diagnosis generation and local-video import actions.

- [ ] **Step 5: Verify Web GREEN and commit**

```powershell
pnpm exec tsx --test tests/web-structured-generation-progress.test.ts tests/web-observation-pages.test.ts tests/web-task-pages.test.ts
pnpm --filter @hongtai/web typecheck
pnpm --filter @hongtai/web build
git diff --check
```

Commit:

```powershell
git add -- apps/web tests/web-structured-generation-progress.test.ts tests/web-observation-pages.test.ts tests/web-task-pages.test.ts packages/capacitor-runtime/src/standalone-analysis-service.ts packages/capacitor-runtime/src/standalone-diagnosis-service.ts packages/capacitor-runtime/src/standalone-analysis-service.test.ts packages/capacitor-runtime/src/standalone-diagnosis-service.test.ts
git commit -m "feat(web): render live provider reasoning"
```

## Task 8: Remove five-call residue and update live documentation

**Files:**
- Delete: obsolete module Prompt files after `rg` proves zero callers
- Modify: `docs/架构与工程规范.md`
- Modify: `docs/当前能力与发布状态.md`
- Modify: `docs/前端显示板块对接清单.md`
- Modify: `docs/验收/2026-08-13-v016-modular-ai-progress.md`
- Modify: `CHANGELOG.md`
- Modify: `apps/web/src/pages/ApplicationInfoPage.tsx`

- [ ] **Step 1: Prove obsolete callers and copy**

```powershell
rg -n "diagnosis-(visual|observation|wellness|safety|follow-up)|content-analysis-(overview|hook|structure|style|risks)|必须调用五次|不展示.*reasoning|provider reasoning" packages apps tests docs CHANGELOG.md
```

Classify each hit as replacement, compatibility reader, or obsolete residue before deleting.

- [ ] **Step 2: Delete only zero-caller Prompt/repair files**

Keep shared safety/evidence rules and final formal schemas. Do not create Prompt barrel files.

- [ ] **Step 3: Update live truth**

Document one AI request, runtime-only reasoning, final validation, no reasoning persistence, ordinary resume without reload, and code13 candidate rejection. Historical evidence remains historical.

- [ ] **Step 4: Run cleanup validation and commit**

```powershell
pnpm check
pnpm --filter @hongtai/web build
git diff --check
```

Run UTF-8/U+FFFD and secret-pattern scans over changed text files, then commit exact cleanup paths:

```powershell
git commit -m "refactor: remove five-call generation residue"
```

## Task 9: Prepare and verify the code14 candidate

**Files:**
- Modify: Android version source and release script assertions located by existing version-lineage tests
- Modify: version tests
- Modify: `CHANGELOG.md`, application information copy, current status and acceptance record

- [ ] **Step 1: Write the failing version-lineage expectation**

Change expected identity to:

```text
versionName=0.1.6
versionCode=14
```

Run the focused version test and confirm it fails while source remains code13.

- [ ] **Step 2: Update source identity and release checks**

Change every authoritative code assertion discovered by the version test; do not edit generated APK metadata by hand.

- [ ] **Step 3: Run full host gates**

```powershell
pnpm check
pnpm --filter @hongtai/web build
git diff --check
```

Run the repository’s existing Android Release unit-test, lint, sync, and assemble commands from the release guide. Record exact failures instead of weakening a gate.

- [ ] **Step 4: Build and inspect the new signed candidate only when signing config is available**

Verify package ID, `0.1.6/14`, zipalign, v2/v3 signatures, certificate anchor, SHA-256, byte size and exact source commit. Keep the APK ignored and untracked.

- [ ] **Step 5: Commit the candidate source identity**

```powershell
git add -- <exact version, test, changelog, app-info, status and acceptance paths>
git diff --cached --check
git commit -m "chore(release): prepare v0.1.6 code 14"
```

## Task 10: Device and release gate

- [ ] **Step 1: API 35 simulator regression**

Verify cold start, no white screen, picker open/cancel, ordinary Home return and relevant instrumentation. This is simulator evidence only.

- [ ] **Step 2: Physical-device normal upgrade**

Install code14 over the already tested code13 with the same signature, no uninstall, no data clear and no downgrade flag. Verify `firstInstallTime`, old local data and cold start.

- [ ] **Step 3: Physical-device functional paths**

Run tongue, face, one Xiaohongshu link, one local MP4, foreground/background return, visible Xiaomi or StepFun reasoning, one normal provider call per generation, five section reveals and automatic status refresh.

- [ ] **Step 4: Stop at the publication boundary unless every gate passes**

Do not upload, deploy the download page, merge `main` or push merely because host/simulator tests pass. Public upload and page deployment remain user-operated external actions followed by hash re-verification.

## Plan self-review

- Every design requirement maps to Tasks 1–10.
- Tests precede production changes in each source phase.
- Provider type names, DTO names and response group names are consistent throughout.
- No new database, background service, Agent loop, WebSocket, polling or generic event bus is introduced.
- Reasoning is visible only in an active runtime snapshot and is explicitly excluded from all persistence.
- The plan contains no placeholder implementation step; physical-device and external publication remain truthful gates rather than claimed outcomes.
