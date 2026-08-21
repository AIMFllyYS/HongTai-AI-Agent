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

test("templates and production use real runtimes while publishing remains planned", () => {
  const pages = ["pages/PublishPage.tsx"];

  for (const page of pages) {
    const source = read(page);
    assert.match(source, /FeatureUnavailablePanel/, `${page} should disclose its planned state`);
    assert.match(source, /disabled/, `${page} should disable unavailable feature controls`);
    assert.match(source, /尚未接入/, `${page} should use clear planned-capability copy`);
  }

  const create = read("pages/CreatePage.tsx");
  const createForms = read("features/production/production-setup-forms.tsx");
  const createSurface = `${create}\n${createForms}`;
  assert.match(create, /runtime\.production\.(create|importAssets|generatePlan|render)/);
  assert.match(create, /runtime\.production\.(removeAsset|removeOutput|delete)/);
  assert.match(create, /IssueNotice/);
  assert.match(createSurface, /参考哪条拆解/);
  assert.match(createSurface, /这次想讲什么/);
  assert.doesNotMatch(createSurface, />(?:content-analysis\.v1|production-plan\.v1)</u);
  assert.match(create, /useAppResume\(\(\) => \{\s*void load\(\);\s*void applyAssetRecovery\(\);/u);
  assert.doesNotMatch(create, /useAppResume\(load\)/);
  assert.doesNotMatch(create, /@capacitor\/app/);
  assert.doesNotMatch(create, /viewModel\.(templates|profileTags|materialFilters|generationEta|actionLabel)/);
  assert.doesNotMatch(create, /template-tile__selected/);
  assert.match(create, /<ProductionComposerPanel\b/);
  assert.match(createForms, /<Switch checked=\{avatarOn\}/);
  assert.match(create, /mode === "avatar" \? \{ avatarScript \}/);

  const templates = read("pages/TemplatesPage.tsx");
  assert.match(templates, /runtime\.templates\.(list|createFromAnalysis|create|update|delete)/);
  assert.match(templates, /runtime\.analysis\.get/);
  assert.match(templates, /确认删除模板/);
  assert.match(templates, /\{readIssue \? <button className="text-action" onClick=\{\(\) => void load\(\)\} type="button">刷新<\/button> : null\}/);
  assert.match(templates, /templates-section-head[\s\S]*templates-search[\s\S]*本机精选 · 滑动查看/s);
  assert.match(templates, /templates-catalog-empty/);
  assert.match(templates, /使用次数未解析到/);
  assert.match(templates, /未解析到这类模板/);
  assert.match(templates, /HomeMastheadActions/);
  assert.doesNotMatch(templates, /data\/fixtures|visualData|viewModel/);
  assert.doesNotMatch(templates, /官方模板|热度/);
  assert.doesNotMatch(templates, /2\.4 万|万人用过/);
  assert.doesNotMatch(templates, /unsplash|images\.unsplash/i);
  assert.doesNotMatch(templates, /pathForRoute\("create"\)/);

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
  assert.match(libraryStyles, /\.template-workspace/);
  assert.match(creationStyles, /@media\s*\(max-width:\s*26\.875rem\)[\s\S]*\.planned-workbench__footer[^}]*grid-template-columns:\s*1fr/);
  assert.match(creationStyles, /@media\s*\(max-width:\s*26\.875rem\)[\s\S]*\.platform-grid[^}]*grid-template-columns:\s*1fr/);
  assert.match(libraryStyles, /@media\s*\(max-width:\s*26\.875rem\)[\s\S]*\.template-editor__actions[^}]*grid-template-columns:\s*1fr/);
});

test("production runtime uses capability-gated shells while fixtures stay explicit", () => {
  const app = read("App.tsx");

  assert.match(app, /runtime && renderedRoute\.key === "create"[\s\S]*<CreatePage navigate=\{navigate\} runtime=\{runtime\} searchEpoch=\{searchEpoch\} \/>/);
  assert.match(app, /runtime && renderedRoute\.key === "templates"[\s\S]*<TemplatesPage navigate=\{navigate\} runtime=\{runtime\} \/>/);
  assert.doesNotMatch(app, /renderedRoute\.key === "publish"/);
  assert.doesNotMatch(app, /<PublishPage/);
  assert.doesNotMatch(app, /visualData\.getPublish\(\)/);
  assert.match(app, /if \(visualData\) \{[\s\S]*visualData\.getCreate\(\)/);

  for (const page of ["pages/CreatePage.tsx", "pages/PublishPage.tsx"]) {
    assert.match(read(page), /viewModel\?:/);
  }
});

test("production deletion requires named confirmation controls", () => {
  const card = read("components/ProductionProjectCard.tsx");
  assert.match(card, /aria-label=\{`删除素材/);
  assert.match(card, /确认删除成片/);
  assert.match(card, /确认删除项目/);
  assert.match(card, /onRemoveAsset/);
  assert.match(card, /onRemoveOutput/);
  assert.match(card, /onDeleteProject/);
});
