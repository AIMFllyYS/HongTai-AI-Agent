import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeUnfinishedWork } from "@hongtai/core";

import { RuntimeOperationRegistry } from "./runtime-operation-registry.js";
import { StandaloneRuntimeRecovery, type StandaloneRecoveryPort } from "./standalone-runtime-recovery.js";

function persisted(kind: RuntimeUnfinishedWork["kind"], id: string): RuntimeUnfinishedWork {
  return { kind, id, source: "persisted", execution: "in-process" };
}

function port(
  unfinished: readonly RuntimeUnfinishedWork[],
  recovered: readonly RuntimeUnfinishedWork[] = unfinished,
): StandaloneRecoveryPort {
  return {
    inspectUnfinishedWork: async () => unfinished,
    recoverInterruptedWork: async () => recovered,
  };
}

test("StandaloneRuntimeRecovery combines deterministic memory and persisted work without duplicates", async () => {
  const operations = new RuntimeOperationRegistry();
  const finish = operations.begin({ kind: "transient-operation", id: "photo", execution: "external-activity" });
  const duplicate = persisted("ingest", "task-1");
  const recovery = new StandaloneRuntimeRecovery({
    operations,
    sources: [
      port([persisted("production-render", "project-1"), duplicate]),
      port([duplicate, persisted("content-analysis", "task-2")]),
    ],
  });

  assert.deepEqual(await recovery.inspectUnfinishedWork(), [
    persisted("content-analysis", "task-2"),
    persisted("ingest", "task-1"),
    persisted("production-render", "project-1"),
    { kind: "transient-operation", id: "photo", source: "memory", execution: "external-activity" },
  ]);
  finish();
});

test("StandaloneRuntimeRecovery reports the before-state and every recovered persisted workflow", async () => {
  const operations = new RuntimeOperationRegistry();
  const task = port([persisted("ingest", "task-1")]);
  const diagnosis = port([persisted("diagnosis-report", "session-1")]);
  const recovery = new StandaloneRuntimeRecovery({ operations, sources: [task, diagnosis] });

  assert.deepEqual(await recovery.recoverInterruptedWork(), {
    unfinished: [persisted("diagnosis-report", "session-1"), persisted("ingest", "task-1")],
    recovered: [persisted("diagnosis-report", "session-1"), persisted("ingest", "task-1")],
  });
});

test("StandaloneRuntimeRecovery attempts every owner before surfacing a partial recovery failure", async () => {
  const calls: string[] = [];
  const failing: StandaloneRecoveryPort = {
    inspectUnfinishedWork: async () => [persisted("diagnosis-report", "session-1")],
    recoverInterruptedWork: async () => {
      calls.push("diagnosis");
      throw new Error("diagnosis store unavailable");
    },
  };
  const succeeding: StandaloneRecoveryPort = {
    inspectUnfinishedWork: async () => [persisted("ingest", "task-1")],
    recoverInterruptedWork: async () => {
      calls.push("task");
      return [persisted("ingest", "task-1")];
    },
  };
  const recovery = new StandaloneRuntimeRecovery({ operations: new RuntimeOperationRegistry(), sources: [failing, succeeding] });

  await assert.rejects(() => recovery.recoverInterruptedWork(), AggregateError);
  assert.deepEqual(calls.sort(), ["diagnosis", "task"]);
});
