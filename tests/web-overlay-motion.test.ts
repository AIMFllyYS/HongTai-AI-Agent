import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { shouldDismissSheet } from "../apps/web/src/motion/sheet-dismiss";

const read = (relativePath: string) => readFileSync(join(process.cwd(), "apps", "web", "src", relativePath), "utf8");

test("sheet dismisses on a downward drag past distance or velocity", () => {
  assert.equal(shouldDismissSheet(81, 0), true);
  assert.equal(shouldDismissSheet(80, 0), false);
  assert.equal(shouldDismissSheet(20, 451), true);
  assert.equal(shouldDismissSheet(-40, -800), false);
});

test("all product sheets and the compose plus share Overlay rise", () => {
  const overlay = read("components/Overlay.tsx");
  const sheet = read("components/Sheet.tsx");
  const compose = read("components/ComposeSheet.tsx");
  const more = read("components/TaskMoreActionsSheet.tsx");
  const settings = read("pages/SettingsPage.tsx");
  const confirm = read("features/diagnosis/observation-start-panels.tsx");
  const followUp = read("features/diagnosis/observation-follow-up-sheet.tsx");

  assert.match(overlay, /data-no-swipe/);
  assert.match(overlay, /dragControls/);
  assert.match(sheet, /placement="rise"/);
  assert.match(sheet, /OverlayDragRegion/);
  assert.match(sheet, /向下拖动关闭/);
  assert.match(read("styles/components.css"), /\.sheet__handle\s*\{[^}]*width:\s*3rem[^}]*height:\s*0\.3125rem/s);
  assert.match(compose, /title="新建"/);
  assert.match(more, /title="更多操作"/);
  assert.match(settings, /<Sheet /);
  assert.match(confirm, /observation-confirm-sheet/);
  assert.match(followUp, /placement="rise"/);
  assert.match(followUp, /OverlayDragRegion/);
  assert.match(followUp, /AI 追问/);
  assert.match(followUp, /关闭追问/);
  assert.doesNotMatch(sheet, /createPortal/);
});

test("material library reuses Overlay center instead of a private backdrop", () => {
  const entry = read("components/MaterialLibraryHeaderAction.tsx");
  const styles = read("styles/components.css");
  assert.match(entry, /placement="center"/);
  assert.doesNotMatch(entry, /createPortal/);
  assert.doesNotMatch(styles, /material-library-dialog__backdrop/);
  assert.match(styles, /\.overlay-scrim\s*\{[^}]*background:\s*var\(--overlay-scrim\)/s);
});
