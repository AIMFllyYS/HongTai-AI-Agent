import type { VitalityResultViewModel, VitalityScanViewModel } from "../visual-types";
import { images, media } from "./media";

export const vitalityScan: VitalityScanViewModel = {
  source: "design-fixture",
  brand: "Vitality AI",
  title: "AI 智能诊疗",
  description: "请将面部或舌部对准扫描框以获取精准分析。",
  scanLabel: "立即拍摄",
  uploadLabel: "上传照片",
  adviceTitle: "拍摄建议",
  advice: [
    { icon: "sunny", text: "保持光线明亮自然，避免阴影。" },
    { icon: "face", text: "面部放松，舌体自然伸出不卷曲。" },
  ],
  historyTitle: "最近诊断记录",
  historyDescription: "查看过往分析报告",
};

export const vitalityResult: VitalityResultViewModel = {
  source: "design-fixture",
  title: "诊断结果",
  scoreTitle: "整体健康评分",
  scoreDescription: "基于面部和舌象AI分析",
  score: 86,
  scoreMax: 100,
  faceMedia: media("面部分析示例图", "sage", images.face, "4 / 3"),
  tongueMedia: media("舌象分析示例图", "warm", images.tongue, "4 / 3"),
  faceTitle: "面部分析",
  tongueTitle: "舌象分析",
  completedLabel: "已完成",
  faceObservations: [
    { label: "气色 (Complexion)", value: "红润，略带疲惫" },
    { label: "眼部 (Eyes)", value: "轻微黑眼圈" },
  ],
  tongueObservations: [
    { label: "舌色 (Tongue Body Color)", value: "淡红" },
    { label: "苔色 (Coating Color)", value: "薄白" },
  ],
  recommendationTitle: "AI 调理建议",
  recommendations: [
    { icon: "check_circle", text: "综合诊断显示您目前处于亚健康状态，主要表现为轻度气虚。建议规律作息，避免熬夜。" },
    { icon: "restaurant", text: "饮食方面，可适量增加山药、红枣等健脾益气的食物，减少生冷油腻摄入。" },
    { icon: "self_improvement", text: "建议每日进行轻度有氧运动，如太极、瑜伽或快走，以促进气血运行。" },
  ],
  saveLabel: "保存报告",
  consultLabel: "咨询专家",
};
