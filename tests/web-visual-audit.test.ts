import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("output/playwright/visual_audit.py", "utf8");

test("visual audit covers the foundation acceptance boundaries", () => {
  for (const marker of [
    "data-visual-theme",
    "rgb(251, 253, 250)",
    "rgb(38, 166, 154)",
    "rgb(0, 77, 64)",
    "aria-controls",
    "aria-labelledby",
    "暂无拆解记录",
    "home-empty.png",
    "\\ufffd",
    "h1",
  ]) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${marker} should be audited`);
  }
});
