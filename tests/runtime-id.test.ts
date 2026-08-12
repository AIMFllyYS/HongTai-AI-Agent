import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeId } from "../packages/core/src/index.ts";

test("createRuntimeId emits UUID-shaped identifiers without crypto.randomUUID", () => {
  const first = createRuntimeId();
  const second = createRuntimeId();

  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(second, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, second);
});
