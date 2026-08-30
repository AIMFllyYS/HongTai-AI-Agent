import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeOperationRegistry } from "./runtime-operation-registry.js";
import { TaskGuardClient } from "./task-guard-client.js";
import type { StandaloneForegroundServicePlugin, StandaloneTaskGuardPlugin } from "./standalone-bridge.js";

interface GuardCalls {
  readonly foreground: string[];
  readonly wake: string[];
  readonly policy: boolean[];
}

function createNative(options?: { readonly startFails?: boolean }) {
  const calls: GuardCalls = { foreground: [], wake: [], policy: [] };
  const taskGuard: StandaloneTaskGuardPlugin = {
    setBackgroundRunEnabled: async ({ enabled }) => { calls.policy.push(enabled); },
    holdWakeLock: async () => {
      calls.wake.push("hold");
      return { totalHolds: calls.wake.length };
    },
    releaseWakeLock: async () => {
      calls.wake.push("release");
      return { totalHolds: 0 };
    },
    getBackgroundRunStatus: async () => ({ batteryOptimizationIgnored: true, wakeLockHolds: 0 }),
    requestIgnoreBatteryOptimizations: async () => ({ opened: "request" }),
  };
  const foregroundService: StandaloneForegroundServicePlugin = {
    startForegroundService: async () => {
      if (options?.startFails) throw new Error("foreground service unavailable");
      calls.foreground.push("start");
    },
    stopForegroundService: async () => { calls.foreground.push("stop"); },
    createNotificationChannel: async () => { calls.foreground.push("channel"); },
    checkPermissions: async () => ({ display: "granted" }),
    requestPermissions: async () => ({ display: "granted" }),
  };
  return { calls, taskGuard, foregroundService };
}

test("TaskGuardClient is a transparent no-op without native plugins", async () => {
  const client = new TaskGuardClient({});
  const order: string[] = [];
  const value = await client.withTaskGuard("ingest", async () => {
    order.push("run");
    return 7;
  });
  assert.equal(value, 7);
  assert.deepEqual(order, ["run"]);
  const status = await client.getStatus();
  assert.equal(status.supported, false);
  assert.equal(status.enabled, true);
  assert.equal(status.activeGuards, 0);
  assert.equal(status.notificationPermission, "unknown");
});

test("TaskGuardClient starts the guard for the first task and stops it after the last", async () => {
  const { calls, taskGuard, foregroundService } = createNative();
  const client = new TaskGuardClient({ taskGuard, foregroundService });

  await client.withTaskGuard("ingest", async () => "done");

  assert.deepEqual(calls.foreground, ["channel", "start", "stop"]);
  assert.deepEqual(calls.wake, ["hold", "release"]);
});

test("TaskGuardClient releases the guard when the guarded task fails", async () => {
  const { calls, taskGuard, foregroundService } = createNative();
  const client = new TaskGuardClient({ taskGuard, foregroundService });
  const failure = new Error("pipeline failed");

  await assert.rejects(
    client.withTaskGuard("production-plan", async () => { throw failure; }),
    (error) => error === failure,
  );

  assert.deepEqual(calls.foreground, ["channel", "start", "stop"]);
  assert.deepEqual(calls.wake, ["hold", "release"]);
});

test("TaskGuardClient reference-counts concurrent tasks into one service cycle", async () => {
  const { calls, taskGuard, foregroundService } = createNative();
  const client = new TaskGuardClient({ taskGuard, foregroundService });
  let finishIngest!: () => void;
  let finishAnalysis!: () => void;
  const ingest = client.withTaskGuard("ingest", () => new Promise<void>((resolve) => { finishIngest = resolve; }));
  const analysis = client.withTaskGuard("content-analysis", () => new Promise<void>((resolve) => { finishAnalysis = resolve; }));

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls.foreground, ["channel", "start"]);
  assert.deepEqual(calls.wake, ["hold"]);

  finishIngest();
  await ingest;
  assert.deepEqual(calls.foreground, ["channel", "start"]);
  assert.deepEqual(calls.wake, ["hold"]);

  finishAnalysis();
  await analysis;
  assert.deepEqual(calls.foreground, ["channel", "start", "stop"]);
  assert.deepEqual(calls.wake, ["hold", "release"]);
});

test("TaskGuardClient keeps the guarded task alive when the foreground service fails to start", async () => {
  const { calls, taskGuard, foregroundService } = createNative({ startFails: true });
  const client = new TaskGuardClient({ taskGuard, foregroundService });

  const value = await client.withTaskGuard("production-render", async () => 42);

  assert.equal(value, 42);
  assert.deepEqual(calls.foreground, ["channel", "stop"]);
  assert.deepEqual(calls.wake, ["hold", "release"]);
});

test("TaskGuardClient setEnabled(false) makes guarding a no-op and mirrors the policy flag", async () => {
  const { calls, taskGuard, foregroundService } = createNative();
  const client = new TaskGuardClient({ taskGuard, foregroundService });
  await client.setEnabled(false);

  await client.withTaskGuard("ingest", async () => "done");
  assert.deepEqual(calls.foreground, []);
  assert.deepEqual(calls.wake, []);

  const status = await client.getStatus();
  assert.equal(status.enabled, false);
  assert.equal(status.supported, true);
  assert.deepEqual(calls.policy, [false]);
});

test("TaskGuardClient reports measured status from the native plugins", async () => {
  const { taskGuard, foregroundService } = createNative();
  const client = new TaskGuardClient({ taskGuard, foregroundService });

  const status = await client.getStatus();

  assert.deepEqual(status, {
    schemaVersion: "background-run-status.v1",
    enabled: true,
    supported: true,
    batteryOptimizationIgnored: true,
    notificationPermission: "granted",
    activeGuards: 0,
  });
});

test("TaskGuardClient rethrows invalid battery-optimization surfaces", async () => {
  const taskGuard: StandaloneTaskGuardPlugin = {
    setBackgroundRunEnabled: async () => undefined,
    holdWakeLock: async () => ({ totalHolds: 1 }),
    releaseWakeLock: async () => ({ totalHolds: 0 }),
    getBackgroundRunStatus: async () => ({ batteryOptimizationIgnored: false, wakeLockHolds: 0 }),
    requestIgnoreBatteryOptimizations: async () => ({ opened: "somewhere-else" }),
  };
  const client = new TaskGuardClient({ taskGuard, foregroundService: {} as StandaloneForegroundServicePlugin });
  await assert.rejects(() => client.requestIgnoreBatteryOptimizations(), /电池优化/);
});

test("RuntimeOperationRegistry guards long-task kinds and skips transient operations", async () => {
  const { calls, taskGuard, foregroundService } = createNative();
  const client = new TaskGuardClient({ taskGuard, foregroundService });
  const registry = new RuntimeOperationRegistry({ taskGuard: client });

  await registry.track({ kind: "transient-operation", id: "probe:text", execution: "in-process" }, async () => "probe");
  assert.deepEqual(calls.foreground, []);
  assert.deepEqual(calls.wake, []);

  await registry.track({ kind: "ingest", id: "task-1", execution: "in-process" }, async () => "ingested");
  assert.deepEqual(calls.foreground, ["channel", "start", "stop"]);
  assert.deepEqual(calls.wake, ["hold", "release"]);
});

test("RuntimeOperationRegistry without a guard keeps its previous behavior", async () => {
  const registry = new RuntimeOperationRegistry();
  const value = await registry.track({ kind: "ingest", id: "task-1", execution: "in-process" }, async () => "plain");
  assert.equal(value, "plain");
  assert.deepEqual(registry.list(), []);
});
