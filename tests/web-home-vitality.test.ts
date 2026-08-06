import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("homepage keeps static display state and design-owned copy behind the view model", () => {
  const types = read("data/visual-types.ts");
  const fixture = read("data/fixtures/home.ts");
  const page = read("pages/HomePage.tsx");

  assert.match(types, /emptyActionLabel:\s*string/);
  assert.match(fixture, /emptyActionLabel:/);
  for (const field of ["recentToggleLabel", "emptyTitle", "emptyDescription", "emptyActionLabel"]) {
    assert.match(page, new RegExp(`viewModel\\.${field}`), `${field} should come from the view model`);
  }
  assert.match(page, /useState/);
  assert.match(page, /name="link"/);
  assert.match(page, /name="info"/);
  assert.match(page, /name="bolt"/);
  assert.match(page, /size="lg"/);
  assert.doesNotMatch(page, /home-tip/);
  assert.doesNotMatch(page, /subtitle="AI 视频内容工作台"/);
  assert.doesNotMatch(page, /<SectionHeading title="AI 能力"/);
});

test("vitality pages explicitly use the warm-soft-tech visual theme", () => {
  for (const page of ["pages/VitalityScanPage.tsx", "pages/VitalityResultPage.tsx"]) {
    assert.match(read(page), /visualTheme="warm-soft-tech"/);
  }

  const tokens = read("styles/tokens.css");
  for (const value of ["#004d40", "#26a69a", "#f2f7f2", "#fbfdfa"]) {
    assert.match(tokens, new RegExp(value, "i"), `${value} should be present in the warm-soft-tech mapping`);
  }
});

test("vitality scan uses the HongTai AI brand in the shared app header", () => {
  const fixture = read("data/fixtures/vitality.ts");

  assert.match(fixture, /brand:\s*"宏泰AI智能体"/);
  assert.doesNotMatch(fixture, /brand:\s*"Vitality AI"/);
});
