import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { RuntimeUnfinishedWork } from "../packages/core/src/index";
import { installAppLifecycleCoordinator } from "../apps/web/src/runtime/app-lifecycle";

const webRoot = join(process.cwd(), "apps", "web", "src");

function harness(inspect: () => Promise<readonly RuntimeUnfinishedWork[]>) {
  let listener: ((state: { readonly isActive: boolean }) => void) | undefined;
  let reloads = 0;
  let resumes = 0;
  let removals = 0;
  return {
    install: () => installAppLifecycleCoordinator({
      subscribe: async (next) => {
        listener = next;
        return { remove: async () => { removals += 1; } };
      },
      inspectUnfinishedWork: inspect,
      reload: () => { reloads += 1; },
      notifyResume: () => { resumes += 1; },
    }),
    emit: (isActive: boolean) => { listener?.({ isActive }); },
    counts: () => ({ reloads, resumes, removals }),
  };
}

test("inactive then active reloads when in-process work is unfinished", async () => {
  const subject = harness(async () => [{ kind: "ingest", id: "task-1", source: "persisted", execution: "in-process" }]);
  const installed = await subject.install();

  subject.emit(false);
  subject.emit(true);
  await installed.whenIdle();

  assert.deepEqual(subject.counts(), { reloads: 1, resumes: 0, removals: 0 });
});

test("external Activity return refreshes without reloading its WebView", async () => {
  const subject = harness(async () => [{ kind: "transient-operation", id: "photo", source: "memory", execution: "external-activity" }]);
  const installed = await subject.install();

  subject.emit(false);
  subject.emit(true);
  await installed.whenIdle();

  assert.deepEqual(subject.counts(), { reloads: 0, resumes: 1, removals: 0 });
});

test("initial and repeated active events do not create false resume transitions", async () => {
  let inspections = 0;
  const subject = harness(async () => { inspections += 1; return []; });
  const installed = await subject.install();

  subject.emit(true);
  subject.emit(true);
  await installed.whenIdle();
  assert.equal(inspections, 0);

  subject.emit(false);
  subject.emit(true);
  subject.emit(true);
  await installed.whenIdle();
  assert.equal(inspections, 1);
  assert.deepEqual(subject.counts(), { reloads: 0, resumes: 1, removals: 0 });

  await installed.remove();
  assert.equal(subject.counts().removals, 1);
});

test("an incomplete lifecycle inspection fails closed through a controlled reload", async () => {
  const subject = harness(async () => { throw new Error("private storage unavailable"); });
  const installed = await subject.install();

  subject.emit(false);
  subject.emit(true);
  await installed.whenIdle();

  assert.deepEqual(subject.counts(), { reloads: 1, resumes: 0, removals: 0 });
});

test("the APK bootstrap uses only the official App signal and unified recovery boundary", () => {
  const main = readFileSync(join(webRoot, "main.tsx"), "utf8");

  assert.match(main, /from "@capacitor\/app"/);
  assert.match(main, /CapacitorApp\.addListener\("appStateChange"/);
  assert.match(main, /runtime\.recovery\.recoverInterruptedWork\(\)/);
  assert.match(main, /installAppLifecycleCoordinator/);
  assert.doesNotMatch(main, /runtime\.tasks\.getStartupRecovery\(\)/);
});

test("the shared resume hook owns one exact add and remove event pair", () => {
  const hookPath = join(webRoot, "hooks", "useAppResume.ts");
  assert.equal(existsSync(hookPath), true);
  const hook = readFileSync(hookPath, "utf8");

  assert.match(hook, /window\.addEventListener\("hongtai:app-resumed", handle\)/);
  assert.match(hook, /window\.removeEventListener\("hongtai:app-resumed", handle\)/);
  assert.doesNotMatch(hook, /@capacitor\/app/);
});
