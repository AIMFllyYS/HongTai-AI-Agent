import type { VitalityResultViewModel, VitalityScanViewModel } from "../visual-types";
import { images, media } from "./media";

export const vitalityScan: VitalityScanViewModel = {
  source: "design-fixture",
  brand: "宏泰AI智能体",
  title: "图片观察准备",
  description: "选择一张舌象或面部图片，按本地观察流程处理。",
  scanLabel: "立即拍摄",
  uploadLabel: "上传照片",
  adviceTitle: "拍摄建议",
  advice: [
    { icon: "sunny", text: "保持光线明亮自然，避免阴影。" },
    { icon: "face", text: "面部放松，舌体自然伸出不卷曲。" },
  ],
  historyTitle: "本地观察记录",
  historyDescription: "查看已保存的观察报告",
};

export const vitalityResult: VitalityResultViewModel = {
  source: "design-fixture",
  title: "观察报告示意",
  overviewTitle: "图片可见要点",
  overviewDescription: "设计夹具不会替代用户真实的本地观察报告。",
  faceMedia: media("面部分析示例图", "sage", images.face, "4 / 3"),
  tongueMedia: media("舌象分析示例图", "warm", images.tongue, "4 / 3"),
  faceTitle: "面部图片示意",
  tongueTitle: "舌象图片示意",
  completedLabel: "已完成",
  faceObservations: [
    { label: "可见区域", value: "示意内容，不代表真实观察" },
    { label: "图片质量", value: "需要以正式报告为准" },
  ],
  tongueObservations: [
    { label: "可见区域", value: "示意内容，不代表真实观察" },
    { label: "拍摄条件", value: "需要以正式报告为准" },
  ],
  recommendationTitle: "日常记录提示",
  recommendations: [
    { icon: "check_circle", text: "在相近光线和角度下记录图片，便于比较变化。" },
    { icon: "restaurant", text: "如需日常建议，请以正式报告中可追溯的观察依据为准。" },
    { icon: "self_improvement", text: "如有持续不适或担忧，请咨询合适的专业人员。" },
  ],
  saveLabel: "保存设计备注",
  consultLabel: "查看说明",
};
