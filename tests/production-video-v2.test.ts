import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("production v2 prompt separates original copy from analysis and forbids spoken-copy reuse", () => {
  const contract = read("packages/ai/src/contracts/production-planning.ts");
  const prompt = read("packages/ai/src/prompts/production-planning.ts");
  const flow = read("packages/ai/src/flows/production/production-planning-flow.ts");

  assert.match(contract, /originalSourceText/u);
  assert.match(contract, /headlineText/u);
  assert.match(contract, /textPreset/u);
  assert.match(prompt, /仅供创作参考/u);
  assert.match(prompt, /不得把原文或拆解中的句子当作本次口播内容/u);
  assert.match(prompt, /爆款原文（参考，不可作为口播）/u);
  assert.match(prompt, /正式爆款拆解（参考，不可照抄）/u);
  assert.match(flow, /assertOriginalNarration/u);
});

test("production v2 UI captures main text preset and Media3 renders top and bottom overlays", () => {
  const page = read("apps/web/src/pages/CreatePage.tsx");
  const schema = read("packages/ai/src/schemas/production-plan.ts");
  const parser = read("android/app/src/main/java/com/hongtai/aiagent/production/ProductionPlanParser.kt");
  const renderer = read("android/app/src/main/java/com/hongtai/aiagent/production/ProductionRenderer.kt");

  assert.match(page, /主文字/u);
  assert.match(page, /文字预设/u);
  assert.match(page, /production-headline/u);
  assert.match(page, /production-text-preset/u);
  assert.match(schema, /production-plan\.v2/u);
  assert.match(schema, /textOverlay/u);
  assert.match(parser, /ProductionTextOverlay/u);
  assert.match(renderer, /headlineOverlays/u);
  assert.match(renderer, /captionOverlays/u);
});
