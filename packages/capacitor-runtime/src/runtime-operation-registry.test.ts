import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeOperationRegistry } from "./runtime-operation-registry.js";

test("RuntimeOperationRegistry exposes an in-process operation until its promise settles", async () => {
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

test("RuntimeOperationRegistry releases a rejected external Activity operation", async () => {
  const registry = new RuntimeOperationRegistry();
  const failure = new Error("picker failed");

  await assert.rejects(
    registry.track(
      { kind: "transient-operation", id: "photo-picker", execution: "external-activity" },
      async () => { throw failure; },
    ),
    (error) => error === failure,
  );

  assert.deepEqual(registry.list(), []);
});

test("RuntimeOperationRegistry reference-counts callers with the same stable identity", () => {
  const registry = new RuntimeOperationRegistry();
  const operation = { kind: "ingest", id: "task-1", execution: "in-process" } as const;
  const finishFirst = registry.begin(operation);
  const finishSecond = registry.begin(operation);

  finishFirst();
  assert.equal(registry.list().length, 1);

  finishSecond();
  finishSecond();
  assert.deepEqual(registry.list(), []);
});
