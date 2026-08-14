import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const webRoot = join(process.cwd(), "apps", "web");
const readSource = (relativePath: string) => readFileSync(join(webRoot, "src", relativePath), "utf8");

test("bottom navigation opens the public Fudi material image in an accessible dialog", () => {
  const navigation = readSource("components/BottomNav.tsx");
  const styles = readSource("styles/components.css");
  const materialPath = join(webRoot, "public", "materials", "fudi-material-library.jpg");

  assert.equal(existsSync(materialPath), true, "the supplied material image must live under public/materials");
  assert.match(navigation, />富迪素材库</);
  assert.match(navigation, /setMaterialsOpen\(true\)/);
  assert.match(navigation, /role="dialog"/);
  assert.match(navigation, /aria-modal="true"/);
  assert.match(navigation, /\/materials\/fudi-material-library\.jpg/);
  assert.match(navigation, /alt="富迪素材库宣传图"/);
  assert.match(styles, /\.material-library-dialog/);
  assert.match(styles, /\.material-library-dialog__image/);
});

test("material library remains a modal action instead of entering swipe route order", () => {
  const navigation = readSource("navigation/primary-nav.ts");

  assert.doesNotMatch(navigation, /富迪素材库/);
});
