import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("planned feature panel has a safe default capability and clear availability copy", () => {
  const componentPath = join(root, "components", "FeatureUnavailablePanel.tsx");
  assert.equal(existsSync(componentPath), true, "the reusable planned-feature panel should exist");

  const source = read("components/FeatureUnavailablePanel.tsx");
  assert.match(source, /FeatureCapability/);
  assert.match(source, /capability\s*=\s*"planned"/);
  assert.match(source, /尚未接入/);
  assert.match(source, /data-feature-capability/);
});

test("assets and publishing remain planned while creation uses the real production runtime", () => {
  const pages = [
    "pages/AssetsPage.tsx",
    "pages/PublishPage.tsx",
  ];

  for (const page of pages) {
    const source = read(page);
    assert.match(source, /FeatureUnavailablePanel/, `${page} should disclose its planned state`);
    assert.match(source, /disabled/, `${page} should disable unavailable feature controls`);
    assert.match(source, /尚未接入/, `${page} should use clear planned-capability copy`);
  }

  const create = read("pages/CreatePage.tsx");
  assert.match(create, /runtime\.production\.(create|importAssets|generatePlan|render)/);
  assert.match(create, /IssueNotice/);
  assert.match(create, /content-analysis\.v1/);
  assert.match(create, /production-plan\.v1/);
  assert.doesNotMatch(create, /viewModel\.(templates|profileTags|materialFilters|generationEta|actionLabel)/);
  assert.doesNotMatch(create, /template-tile__selected/);
  assert.match(create, /mode === "montage"\s*\?\s*"is-selected"/);
  assert.match(create, /mode === "avatar"\s*\?\s*"is-selected"/);

  const assets = read("pages/AssetsPage.tsx");
  assert.doesNotMatch(assets, /viewModel\.(assets|assetCount|templates|folders|filters|tabs|activeTab)/);
  assert.doesNotMatch(assets, /asset\.kind|StatusBadge/);

  const publish = read("pages/PublishPage.tsx");
  assert.doesNotMatch(publish, /viewModel\.(media|platforms|primaryAction|secondaryActions)/);
  assert.doesNotMatch(publish, /生成成功|AI GENERATED|is-selected/);
});

test("planned feature styling makes disabled controls legible without inventing progress", () => {
  const componentStyles = read("styles/components.css");
  const creationStyles = read("styles/pages/creation.css");
  const libraryStyles = read("styles/pages/library.css");

  assert.match(componentStyles, /\.feature-unavailable-panel/);
  assert.match(componentStyles, /\.button:disabled/);
  assert.match(creationStyles, /\.planned-workbench/);
  assert.match(libraryStyles, /\.planned-library/);
  assert.match(creationStyles, /@media\s*\(max-width:\s*26\.875rem\)[\s\S]*\.planned-workbench__footer[^}]*grid-template-columns:\s*1fr/);
  assert.match(creationStyles, /@media\s*\(max-width:\s*26\.875rem\)[\s\S]*\.platform-grid[^}]*grid-template-columns:\s*1fr/);
  assert.match(libraryStyles, /@media\s*\(max-width:\s*26\.875rem\)[\s\S]*\.planned-library__toolbar[^}]*grid-template-columns:\s*1fr/);
});

test("production runtime uses capability-gated shells while fixtures stay explicit", () => {
  const app = read("App.tsx");

  assert.match(app, /runtime && renderedRoute\.key === "create"[\s\S]*<CreatePage navigate=\{navigate\} runtime=\{runtime\} \/>/);
  assert.match(app, /runtime && renderedRoute\.key === "assets"[\s\S]*<AssetsPage capability=\{runtime\.features\.assets\} navigate=\{navigate\} \/>/);
  assert.match(app, /runtime && renderedRoute\.key === "publish"[\s\S]*<PublishPage capability=\{runtime\.features\.publish\} navigate=\{navigate\} \/>/);
  assert.match(app, /if \(visualData\) \{[\s\S]*visualData\.getCreate\(\)[\s\S]*visualData\.getPublish\(\)[\s\S]*visualData\.getAssets\(\)/);

  for (const page of ["pages/CreatePage.tsx", "pages/AssetsPage.tsx", "pages/PublishPage.tsx"]) {
    assert.match(read(page), /viewModel\?:/);
  }
});
