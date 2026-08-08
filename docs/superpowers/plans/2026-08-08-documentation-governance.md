# Documentation Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository's current capabilities, release boundary, architecture rules, and agent instructions accurate, discoverable, and maintainable.

**Architecture:** Keep the root `AGENTS.md` short and enforceable. Move reader-facing status, task templates, and document ownership into focused files under `docs/`; retain dated acceptance records as historical evidence instead of rewriting their facts. The live documents must describe the current `AppRuntime` capability registry: production/create is available, assets and publish remain planned.

**Tech Stack:** Markdown, pnpm workspace, Capacitor Android, GitHub Issues.

---

### Task 1: Establish the documentation entry points

**Files:**
- Create: `AGENTS.md`
- Create: `docs/文档索引.md`
- Create: `docs/当前能力与发布状态.md`
- Create: `docs/任务执行模板.md`
- Modify: `docs/superpowers/plans/2026-08-08-documentation-governance.md`

- [ ] **Step 1: Add concise repository instructions**

Write `AGENTS.md` with the project identity, layer boundaries, data/security red lines, file-size and reuse rules, task workflow, verification matrix, and local-commit rule. Link to detailed documents instead of duplicating them. Keep the file below 12 KiB and use no nested instruction files until a subdirectory has genuinely different rules.

- [ ] **Step 2: Create a reader-oriented documentation index**

Create `docs/文档索引.md` with four groups: live product/architecture contracts, development/how-to references, historical evidence, and plans/design references. State which document wins if material conflicts.

- [ ] **Step 3: Create a truthful current-status document**

Create `docs/当前能力与发布状态.md` from `packages/capacitor-runtime/src/standalone-app-runtime.ts`: profile, settings, ingest, content analysis, diagnosis, and create are available; assets and publish are planned. State that v0.0.1 is a QA artifact, not a distributable release, and link the relevant P0/P1 GitHub Issues.

- [ ] **Step 4: Create the reusable task contract**

Create `docs/任务执行模板.md` with the exact fields every task must fill: goal, allowed scope, non-goals, owning layer, authority/state keys, acceptance evidence, and completion report. Include a short task-class-to-validation table.

- [ ] **Step 5: Verify stage one and commit**

Run `git diff --check`, a strict UTF-8 scan for the new files, and `git status --short`. Stage only the five paths above, inspect `git diff --cached --check`, then create a local commit with message `docs(governance): add agent and documentation entry points`.

### Task 2: Refresh the living reader documents

**Files:**
- Modify: `README.md`
- Modify: `docs/架构与工程规范.md`
- Modify: `docs/项目整体架构方向.md`
- Modify: `docs/AI应用能力层架构.md`
- Modify: `docs/前端显示板块对接清单.md`

- [ ] **Step 1: Rewrite README as the short entry point**

Keep the project identity, real capability table, a concise architecture map, setup/run commands, QA/release boundary, and links to the canonical docs. Move exhaustive CLI output details to `docs/CLI运行与产物说明.md` rather than duplicating them.

- [ ] **Step 2: Align the architecture overview and AI capability document**

Replace planned-language for local video creation with the actual production flow. Keep assets and publish as planned. Preserve the local-first / no-cloud-backend boundary, and link lifecycle, concurrency, and release risks to the current-status document instead of claiming they are fixed.

- [ ] **Step 3: Make the engineering baseline executable**

Update the global architecture specification so task storage matches the actual directory-scan implementation rather than requiring a nonexistent `tasks/index.json`. Add the rule that the public task cancellation API is not a current runtime capability until its implementation is complete. Link detailed task and verification rules instead of expanding the baseline.

- [ ] **Step 4: Correct the UI integration matrix**

Map `/create` to `production` and current real project/asset/plan/render DTOs. Keep `/assets` and `/publish` as planned. Remove the misleading active cancellation instruction and preserve the no-fake-data rule.

- [ ] **Step 5: Verify stage two and commit**

Run internal Markdown-link validation, strict UTF-8 validation, `pnpm check`, and `pnpm --filter @hongtai/web build`. Stage only Task 2 files, inspect `git diff --cached --check`, then create a local commit with message `docs: align live architecture and capability documentation`.

### Task 3: Label historical evidence without rewriting history

**Files:**
- Modify: `docs/apk-debug-verification.md`
- Modify: `docs/验收/2026-08-07-minimal-apk-delivery.md`
- Modify: `docs/验收/2026-08-08-diagnosis-apk-repair.md`
- Modify: `docs/验收/2026-08-08-apk-photo-ingest-stability-repair.md`
- Modify: `docs/验收/2026-08-08-local-video-production.md`
- Modify: `docs/验收/2026-08-08-release-v0.0.1.md`

- [ ] **Step 1: Add a historical-record notice**

Add a concise notice after each title: the file is dated evidence, not the current capability or release source of truth; readers must use `docs/当前能力与发布状态.md` for current status. For the v0.0.1 file, explicitly preserve that it was debug-signed QA evidence and not a formal release.

- [ ] **Step 2: Verify and commit**

Run the same Markdown-link, UTF-8, and `git diff --check` validation. Stage only the six historical files, inspect the staged diff, and create a local commit with message `docs(history): label dated APK evidence`.

### Task 4: Reader test and final handoff

**Files:**
- Verify: `AGENTS.md`, `README.md`, `docs/文档索引.md`, `docs/当前能力与发布状态.md`, `docs/任务执行模板.md`

- [ ] **Step 1: Test reader questions**

Answer these only from the updated docs: “What can the APK really do now?”, “Can v0.0.1 be distributed?”, “Where may Kotlin business logic live?”, “How should an agent split an oversized file?”, and “Which checks must a UI change run?” Correct any ambiguity found.

- [ ] **Step 2: Final repository verification**

Run `git status --short --branch`, `git log --oneline -3`, `git diff origin/main...HEAD --check`, and the documented validation commands. Preserve the pre-existing untracked `HongTai.zip`; do not stage, delete, ignore, or move it in this documentation task.
