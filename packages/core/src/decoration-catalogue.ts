import {
  DECORATION_IDS,
  decorationRelativePath,
  type DecorationId,
  type DecorationItem,
} from "./decoration";

/**
 * Original geometric garnish. Tags are for the planner; labels are the short Chinese names shown
 * in prompts. Paths are derived from the id so a renamed file cannot silently point elsewhere.
 */
const ITEMS: Readonly<Record<DecorationId, Omit<DecorationItem, "id" | "relativePath">>> = {
  arrow_right: { label: "右箭头", tags: ["指示", "指向", "下一步"] },
  star_mark: { label: "星标", tags: ["强调", "亮点", "好评"] },
  check_mark: { label: "对勾", tags: ["确认", "完成", "通过"] },
  badge_one: { label: "角标1", tags: ["步骤", "序号", "要点"] },
  sparkle: { label: "闪光", tags: ["提亮", "点缀", "新"] },
  underline_brush: { label: "划线", tags: ["重点", "划线", "关键词"] },
  speech_bubble: { label: "气泡", tags: ["提示", "补充", "说明"] },
};

export const DECORATION_CATALOGUE: readonly DecorationItem[] = DECORATION_IDS.map((id) => ({
  id,
  relativePath: decorationRelativePath(id),
  ...ITEMS[id],
}));

export function decorationById(id: DecorationId): DecorationItem {
  const item = DECORATION_CATALOGUE.find((entry) => entry.id === id);
  if (!item) throw new Error(`Unknown decoration id: ${id}`);
  return item;
}
