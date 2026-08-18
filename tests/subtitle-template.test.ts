import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  DEFAULT_SUBTITLE_TEMPLATE_ID,
  isSubtitleTemplateId,
  resolveSubtitleTemplate,
  splitSubtitleLines,
  SUBTITLE_EASING_CURVES,
  SUBTITLE_PLATFORM_SAFE_BOTTOM_PX,
  SUBTITLE_TEMPLATE_CONTRACT_VERSION,
  SUBTITLE_TEMPLATE_IDS,
  SUBTITLE_TEMPLATES,
  subtitleClearsPlatformSafeArea,
  subtitleTemplateById,
  subtitleTextFits,
  type SubtitleTemplate,
} from "../packages/core/src/index";
import { subtitleTemplateSchema } from "../packages/ai/src/index";

const read = (path: string) => readFileSync(path, "utf8");

test("字幕模板契约提供五个内置模板，且都通过 Zod 校验", () => {
  assert.equal(SUBTITLE_TEMPLATE_CONTRACT_VERSION, "subtitle-template.v1");
  assert.equal(SUBTITLE_TEMPLATE_IDS.length, 5);
  assert.equal(SUBTITLE_TEMPLATES.length, 5);
  assert.equal(new Set(SUBTITLE_TEMPLATE_IDS).size, 5);
  assert.deepEqual(SUBTITLE_TEMPLATES.map((template) => template.id), [...SUBTITLE_TEMPLATE_IDS]);

  for (const template of SUBTITLE_TEMPLATES) {
    const parsed = subtitleTemplateSchema.safeParse(template);
    assert.ok(parsed.success, `${template.id} 应通过校验：${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);
    assert.ok(template.stroke || template.box, `${template.id} 必须有描边或底卡`);
    assert.ok(subtitleClearsPlatformSafeArea(template), `${template.id} 必须避开平台底部安全区`);
    assert.ok(template.layout.bottomOffsetPx >= SUBTITLE_PLATFORM_SAFE_BOTTOM_PX);
  }

  assert.equal(subtitleTemplateById(DEFAULT_SUBTITLE_TEMPLATE_ID).id, "classic_line");
  assert.ok(isSubtitleTemplateId("karaoke_glow"));
  assert.equal(isSubtitleTemplateId("timeline_editor"), false);
  assert.deepEqual(SUBTITLE_EASING_CURVES.standard, [0.2, 0, 0, 1]);
  assert.deepEqual(SUBTITLE_EASING_CURVES.emphasized, [0.2, 0.8, 0.2, 1]);
});

test("字幕模板校验拒绝不可渲染或不诚实的参数", () => {
  const base = subtitleTemplateById("classic_line");
  const withPatch = (patch: Partial<SubtitleTemplate>) => subtitleTemplateSchema.safeParse({ ...base, ...patch }).success;

  assert.equal(withPatch({ fill: { hex: "#FFFFFF", opacity: 1 } }), false, "颜色必须小写 #rrggbb");
  assert.equal(withPatch({ fill: { hex: "#fff", opacity: 1 } }), false);
  assert.equal(withPatch({ fill: { hex: "#ffffff", opacity: 1.4 } }), false);
  assert.equal(withPatch({ stroke: null, box: null }), false, "没有描边又没有底卡时读不清");
  assert.equal(withPatch({ layout: { ...base.layout, bottomOffsetPx: 120 } }), false, "不得压进平台安全区");
  assert.equal(withPatch({ typography: { ...base.typography, maxLines: 4 } }), false);
  assert.equal(withPatch({ typography: { ...base.typography, fontSizePx: 12 } }), false);
  assert.equal(withPatch({ emphasis: { ...base.emphasis, peakScale: 1.2 } }), false, "无强调时不应带缩放");
  assert.equal(withPatch({ emphasis: { kind: "recolor", color: null, peakScale: 1, durationMs: 0, easing: "standard" } }), false);
  assert.equal(withPatch({ emphasis: { kind: "bounce", color: null, peakScale: 1, durationMs: 0, easing: "overshoot" } }), false);
  assert.equal(withPatch({ entrance: { kind: "slide_up", durationMs: 180, easing: "standard", travelPx: 0 } }), false);
  assert.equal(
    withPatch({ wordReveal: "karaoke", pendingFill: null, requiresWordTiming: true, wordTimingFallbackId: "keyword_pop" }),
    false,
    "逐字点亮必须给出未读字颜色",
  );
  assert.equal(withPatch({ requiresWordTiming: true, wordTimingFallbackId: null }), false, "依赖词级时间必须给降级模板");
  assert.equal(withPatch({ requiresWordTiming: true, wordTimingFallbackId: "classic_line" }), false, "降级模板不能是自己");
});

test("缺少词级时间时逐字模板降级为逐行，不伪造逐字对齐", () => {
  const withTiming = resolveSubtitleTemplate({ id: "karaoke_glow", hasWordTiming: true });
  assert.equal(withTiming.template.id, "karaoke_glow");
  assert.equal(withTiming.template.wordReveal, "karaoke");
  assert.equal(withTiming.degradedFrom, undefined);

  const withoutTiming = resolveSubtitleTemplate({ id: "karaoke_glow", hasWordTiming: false });
  assert.equal(withoutTiming.template.id, "classic_line");
  assert.equal(withoutTiming.template.wordReveal, "none");
  assert.equal(withoutTiming.degradedFrom, "karaoke_glow");

  assert.equal(resolveSubtitleTemplate({ id: "karaoke_glow" }).template.id, "karaoke_glow");
  assert.equal(resolveSubtitleTemplate({ id: "bounce_accent", hasWordTiming: false }).template.id, "bounce_accent");
  assert.equal(resolveSubtitleTemplate({ id: "unknown_template" }).template.id, DEFAULT_SUBTITLE_TEMPLATE_ID);
  assert.equal(resolveSubtitleTemplate({ id: "" }).template.id, DEFAULT_SUBTITLE_TEMPLATE_ID);
});

test("字幕换行优先按标点断句，超出行数预算时如实暴露而不截断", () => {
  const typography = subtitleTemplateById("classic_line").typography;
  assert.equal(typography.maxCharsPerLine, 14);
  assert.equal(typography.maxLines, 2);

  assert.deepEqual(
    splitSubtitleLines("开场三秒先说结论，别绕弯子再进入正题", typography),
    ["开场三秒先说结论，", "别绕弯子再进入正题"],
  );
  assert.deepEqual(splitSubtitleLines("啊".repeat(20), typography), ["啊".repeat(14), "啊".repeat(6)]);
  assert.deepEqual(splitSubtitleLines("   ", typography), []);
  assert.deepEqual(splitSubtitleLines("短句", typography), ["短句"]);

  assert.equal(subtitleTextFits("开场三秒先说结论，别绕弯子再进入正题", typography), true);
  assert.equal(subtitleTextFits("啊".repeat(50), typography), false);
  assert.equal(splitSubtitleLines("啊".repeat(50), typography).length, 4, "超出预算时返回全部行，不静默截断内容");
});

test("字幕样式决策留在 TypeScript，模板不引入时间轴级编辑概念", () => {
  const contract = read("packages/core/src/subtitle-template.ts");
  const presets = read("packages/core/src/subtitle-template-presets.ts");
  const schema = read("packages/ai/src/schemas/subtitle-template.ts");

  assert.match(contract, /SUBTITLE_REFERENCE_WIDTH_PX = 720/u);
  assert.match(contract, /SUBTITLE_REFERENCE_HEIGHT_PX = 1280/u);
  assert.match(contract, /SUBTITLE_PLATFORM_SAFE_BOTTOM_PX = 180/u);
  assert.match(presets, /requiresWordTiming: true/u);
  assert.match(schema, /superRefine/u);
  assert.doesNotMatch(`${contract}\n${presets}`, /时间轴|关键帧|转场/u);
});
