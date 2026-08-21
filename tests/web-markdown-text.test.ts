import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { parseMarkdown, parseMarkdownInline } from "../apps/web/src/components/markdown-text";

const read = (relativePath: string) => readFileSync(join(process.cwd(), "apps", "web", "src", relativePath), "utf8");

test("markdown parser keeps a safe subset without HTML", () => {
  const blocks = parseMarkdown("# 标题\n\n请看 **湿气** 与 *苔色*，以及 `区域`。\n\n- 第一项\n- 第二项\n\n1. 甲\n2. 乙\n\n```\ncode <script>\n```");
  assert.deepEqual(blocks[0], { type: "h", level: 1, children: [{ type: "text", value: "标题" }] });
  assert.equal(blocks[1]?.type, "p");
  assert.deepEqual(parseMarkdownInline("请看 **湿气** 与 *苔色*，以及 `区域`。"), [
    { type: "text", value: "请看 " },
    { type: "strong", children: [{ type: "text", value: "湿气" }] },
    { type: "text", value: " 与 " },
    { type: "em", children: [{ type: "text", value: "苔色" }] },
    { type: "text", value: "，以及 " },
    { type: "code", value: "区域" },
    { type: "text", value: "。" },
  ]);
  assert.equal(blocks[2]?.type, "ul");
  assert.equal(blocks[3]?.type, "ol");
  assert.deepEqual(blocks[4], { type: "pre", value: "code <script>" });
  const unclosed = parseMarkdown("未闭合 **加粗")[0];
  assert.equal(unclosed?.type, "p");
  if (unclosed?.type === "p") {
    const flattened = unclosed.children.map((node) => node.type === "text" ? node.value : "").join("");
    assert.equal(flattened, "未闭合 **加粗");
  }
});

test("assistant follow-up renders markdown and does not inject HTML; thinking stays plain text", () => {
  const sheet = read("features/diagnosis/observation-follow-up-sheet.tsx");
  const renderer = read("components/MarkdownText.tsx");
  const thinking = read("components/DeepThinkingPanel.tsx");
  assert.match(sheet, /<MarkdownText value=\{body\}/);
  assert.doesNotMatch(sheet, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(renderer, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(thinking, /MarkdownText/);
  assert.doesNotMatch(thinking, /dangerouslySetInnerHTML/);
});
