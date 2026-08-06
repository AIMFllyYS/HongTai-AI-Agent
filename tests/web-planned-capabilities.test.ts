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

test("creation, assets, and publishing pages do not render fixture success states as live capabilities", () => {
  const pages = [
    "pages/CreatePage.tsx",
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
  assert.doesNotMatch(create, /viewModel\.(templates|profileTags|materialFilters|generationEta|actionLabel)/);
  assert.doesNotMatch(create, /is-selected|template-tile__selected/);

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
});

test("production runtime uses capability-gated shells while fixtures stay explicit", () => {
  const app = read("App.tsx");

  assert.match(app, /runtime && renderedRoute\.key === "create"[\s\S]*<CreatePage capability=\{runtime\.features\.create\} navigate=\{navigate\} \/>/);
  assert.match(app, /runtime && renderedRoute\.key === "assets"[\s\S]*<AssetsPage capability=\{runtime\.features\.assets\} navigate=\{navigate\} \/>/);
  assert.match(app, /runtime && renderedRoute\.key === "publish"[\s\S]*<PublishPage capability=\{runtime\.features\.publish\} navigate=\{navigate\} \/>/);
  assert.match(app, /if \(visualData\) \{[\s\S]*visualData\.getCreate\(\)[\s\S]*visualData\.getPublish\(\)[\s\S]*visualData\.getAssets\(\)/);

  for (const page of ["pages/CreatePage.tsx", "pages/AssetsPage.tsx", "pages/PublishPage.tsx"]) {
    assert.match(read(page), /viewModel\?:/);
  }
});
