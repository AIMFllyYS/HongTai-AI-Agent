import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_APPEARANCE_PREFERENCES,
  colorSchemeLabel,
  parseAppearancePreferences,
} from "../apps/web/src/runtime/appearance-preferences";
import { formatByteSize, formatStoredSize, totalMediaByteLength } from "../apps/web/src/runtime/local-cache";

test("appearance preferences keep alerts on and follow the system scheme by default", () => {
  assert.deepEqual(parseAppearancePreferences(null), DEFAULT_APPEARANCE_PREFERENCES);
  assert.equal(parseAppearancePreferences("{").alertsEnabled, true);
  assert.equal(parseAppearancePreferences(JSON.stringify({ alertsEnabled: false, colorScheme: "dark" })).colorScheme, "dark");
  assert.equal(parseAppearancePreferences(JSON.stringify({ alertsEnabled: false, colorScheme: "dark" })).alertsEnabled, false);
  assert.equal(parseAppearancePreferences(JSON.stringify({ colorScheme: "neon" })).colorScheme, "system");
  assert.equal(colorSchemeLabel("system"), "跟随系统");
  assert.equal(colorSchemeLabel("light"), "浅色");
  assert.equal(colorSchemeLabel("dark"), "深色");
});

test("cache and stored media sizes stay honest when the runtime has no number", () => {
  assert.equal(formatByteSize(undefined), "可清理");
  assert.equal(formatByteSize(-3), "可清理");
  assert.equal(formatByteSize(512), "512 B");
  assert.equal(formatByteSize(2048), "2 KB");
  assert.equal(formatByteSize(12 * 1024 * 1024), "12 MB");
  assert.equal(formatStoredSize(undefined), "未解析到");
  assert.equal(totalMediaByteLength([]), undefined);
  assert.equal(totalMediaByteLength([{ byteLength: 128 }, { }]), 128);
  assert.equal(totalMediaByteLength([{ byteLength: "1.2w" as unknown as number }]), undefined);
});
