import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { subtitleTemplateById } from "@hongtai/core";

import { splitEmphasisSegments, subtitleCssColor, subtitleLineProgress, subtitleScale, subtitleStrokeShadow } from "./subtitle-preview-model";

const webRoot = join(process.cwd(), "apps", "web", "src");
const read = (relativePath: string) => readFileSync(join(webRoot, relativePath), "utf8");

test("参考画布按测量宽度等比缩放，未测量前不渲染尺寸", () => {
  assert.equal(subtitleScale(720), 1);
  assert.equal(subtitleScale(360), 0.5);
  assert.equal(subtitleScale(0), 0);
  assert.equal(subtitleScale(-10), 0);
});

test("模板颜色按契约的 hex 与透明度组合，不在组件里另写色值", () => {
  assert.equal(subtitleCssColor({ hex: "#ffffff", opacity: 1 }), "rgba(255, 255, 255, 1)");
  assert.equal(subtitleCssColor({ hex: "#00342b", opacity: 0.94 }), "rgba(0, 52, 43, 0.94)");
  assert.equal(subtitleStrokeShadow(null, 1), undefined);
  assert.equal(subtitleStrokeShadow({ color: { hex: "#000000", opacity: 1 }, widthPx: 6 }, 0), undefined);

  const shadow = subtitleStrokeShadow({ color: { hex: "#001512", opacity: 0.92 }, widthPx: 6 }, 0.5) ?? "";
  assert.equal(shadow.split(", rgba").length - 1 + shadow.split("rgba").length - 1 - (shadow.split(", rgba").length - 1), 8);
  assert.match(shadow, /rgba\(0, 21, 18, 0\.92\)/);
  assert.match(shadow, /1\.50px 0\.00px 0/);
});

test("强调词按契约切段，不改写原文顺序也不吞字", () => {
  assert.deepEqual(splitEmphasisSegments("开场三秒先说结论"), [{ text: "开场三秒先说结论", emphasized: false }]);
  assert.deepEqual(splitEmphasisSegments("开场三秒先说结论", ["三秒", "结论"]), [
    { text: "开场", emphasized: false },
    { text: "三秒", emphasized: true },
    { text: "先说", emphasized: false },
    { text: "结论", emphasized: true },
  ]);
  assert.deepEqual(splitEmphasisSegments("三秒就够", ["三秒"]), [
    { text: "三秒", emphasized: true },
    { text: "就够", emphasized: false },
  ]);
  assert.deepEqual(splitEmphasisSegments("先说结论", ["  ", ""]), [{ text: "先说结论", emphasized: false }]);
  assert.deepEqual(splitEmphasisSegments("先说结论", ["没出现"]), [{ text: "先说结论", emphasized: false }]);

  const segments = splitEmphasisSegments("结论很重要，结论要早说", ["结论"]);
  assert.equal(segments.filter((segment) => segment.emphasized).length, 2);
  assert.equal(segments.map((segment) => segment.text).join(""), "结论很重要，结论要早说");
});

test("逐字点亮按阅读顺序扫过多行，不在每行重新开始", () => {
  const lines = ["开场三秒先说结论，", "别绕弯子再进入正题"];
  assert.equal(subtitleLineProgress(lines, 0, 0), 0);
  assert.equal(subtitleLineProgress(lines, 0, 0.5), 1);
  assert.equal(subtitleLineProgress(lines, 1, 0.5), 0);
  assert.equal(subtitleLineProgress(lines, 1, 1), 1);
  assert.equal(subtitleLineProgress(lines, 0, -1), 0);
  assert.equal(subtitleLineProgress([], 0, 0.5), 0);
  assert.ok(subtitleLineProgress(lines, 1, 0.75) > 0 && subtitleLineProgress(lines, 1, 0.75) < 1);
});

test("字幕预览完全由模板契约驱动，组件里不写死颜色或字号", () => {
  const preview = read("components/SubtitleTemplatePreview.tsx");
  const picker = read("components/SubtitleTemplatePicker.tsx");
  const css = read("styles/components/subtitle-template.css");
  const globals = read("styles/global.css");

  assert.match(preview, /resolveSubtitleTemplate/);
  assert.match(preview, /splitSubtitleLines/);
  assert.match(preview, /template\.typography\.fontSizePx/);
  assert.match(preview, /template\.layout\.bottomOffsetPx/);
  assert.match(preview, /subtitleStrokeShadow\(template\.stroke/);
  assert.match(preview, /data-degraded-from/);
  assert.doesNotMatch(preview, /#[0-9a-fA-F]{6}/);
  assert.doesNotMatch(css, /font-size:\s*\d+px/);

  assert.match(picker, /SUBTITLE_TEMPLATES/);
  assert.match(picker, /role="radiogroup"/);
  assert.match(picker, /degradedFrom/);
  assert.match(picker, /不会伪造逐字对齐/);

  assert.match(globals, /@import "\.\/components\/subtitle-template\.css" layer\(components\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(`${preview}\n${picker}\n${css}`, /时间轴|关键帧|转场编辑/);
});

test("模板选择器的样例文案是合成内容，不含健康功效表述", () => {
  const picker = read("components/SubtitleTemplatePicker.tsx");
  const sample = picker.match(/SAMPLE_TEXT = "([^"]+)"/)?.[1] ?? "";

  assert.ok(sample.length > 0);
  assert.doesNotMatch(sample, /治疗|疗效|包治|根治|药|诊断|痊愈|见效/);
  assert.equal(subtitleTemplateById("classic_line").typography.maxLines, 2);
});
