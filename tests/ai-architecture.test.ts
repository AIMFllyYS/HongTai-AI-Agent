import assert from "node:assert/strict";
import test from "node:test";
import { AI_PACKAGE_STATUS } from "../packages/ai/src/index";

test("AI应用能力保持为独立的纯TypeScript包", () => {
  assert.equal(AI_PACKAGE_STATUS, "AI应用能力层已初始化");
});
