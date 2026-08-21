import type { ComponentType } from "react";

import { PlaybookChromePrimitives, PlaybookColorScale, PlaybookIconGrid, PlaybookTypeScale } from "./chrome";
import {
  PlaybookAnalysisSpecimen,
  PlaybookComposeSpecimen,
  PlaybookNavBarSpecimen,
  PlaybookObservationSpecimen,
  PlaybookObservingSpecimen,
  PlaybookOverlaySpecimen,
  PlaybookPasteSpecimen,
  PlaybookSettingsSpecimen,
  PlaybookSkeletonSpecimen,
  PlaybookTabBarSpecimen,
} from "./flow-specimens";

export type PlaybookGroup = "规范" | "组件" | "主路径" | "观察与账户";

export interface PlaybookSection {
  readonly id: string;
  readonly title: string;
  readonly group: PlaybookGroup;
  readonly summary: string;
  readonly Render: ComponentType;
}

export const playbookSections: readonly PlaybookSection[] = [
  { id: "color", title: "NA2 色系", group: "规范", summary: "白为主，绿为点", Render: PlaybookColorScale },
  { id: "type", title: "NA3 字体", group: "规范", summary: "20 / 16 / 15 / 14 / 12 / 11 / 10", Render: PlaybookTypeScale },
  { id: "icons", title: "NA5 图标", group: "规范", summary: "Lucide 描边 22px", Render: PlaybookIconGrid },
  { id: "tabbar", title: "M/Tab Bar", group: "组件", summary: "48px 栏，32px 方圆加号与左右项居中对齐", Render: PlaybookTabBarSpecimen },
  { id: "navbar", title: "M/Nav Bar", group: "组件", summary: "返回 24px Lucide chevron-left", Render: PlaybookNavBarSpecimen },
  { id: "chrome", title: "按钮与控件", group: "组件", summary: "主按钮、分段、输入、开关、头像", Render: PlaybookChromePrimitives },
  { id: "overlay", title: "Overlay / Sheet", group: "组件", summary: "遮罩上滑，可点可拖", Render: PlaybookOverlaySpecimen },
  { id: "skeleton", title: "骨架屏", group: "组件", summary: "灰块占位，不填假数据", Render: PlaybookSkeletonSpecimen },
  { id: "paste", title: "S1 粘贴链接", group: "主路径", summary: "链接图标、识别行、开始拆解", Render: PlaybookPasteSpecimen },
  { id: "compose", title: "S14 新建", group: "主路径", summary: "智能成片 / 爆款复刻 / 拆解新链接", Render: PlaybookComposeSpecimen },
  { id: "analysis", title: "S4 拆解板块", group: "主路径", summary: "九个展示板块图标", Render: PlaybookAnalysisSpecimen },
  { id: "settings", title: "S8 设置", group: "主路径", summary: "资料、AI、通知、外观、缓存、关于", Render: PlaybookSettingsSpecimen },
  { id: "observing", title: "S9b 观察中", group: "观察与账户", summary: "扫光、深度思考、五模块", Render: PlaybookObservingSpecimen },
  { id: "observation", title: "S10 观察报告", group: "观察与账户", summary: "摘要、明细、参考、建议、安全", Render: PlaybookObservationSpecimen },
];

export function playbookSectionById(id: string | undefined): PlaybookSection | undefined {
  if (!id) return undefined;
  return playbookSections.find((section) => section.id === id);
}
