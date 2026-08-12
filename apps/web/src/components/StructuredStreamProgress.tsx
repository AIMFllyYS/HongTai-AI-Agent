import type { StructuredGenerationModuleId, StructuredGenerationProgressV1 } from "@hongtai/core";

import { GlassCard } from "./GlassCard";
import { Icon } from "./Icon";

export interface StructuredStreamProgressProps {
  readonly title: string;
  readonly progress?: StructuredGenerationProgressV1;
}

const phaseCopy: Readonly<Record<StructuredGenerationProgressV1["phase"], string>> = {
  preparing: "正在准备本次生成所需的真实资料",
  generating: "正在生成当前板块",
  validating: "正在校验当前板块结构",
  saving: "五个板块已完成，正在保存正式结果",
};

const moduleCopy: Readonly<Record<StructuredGenerationModuleId, string>> = {
  "visual-observations": "可见观察",
  "observation-summary": "观察摘要",
  "wellness-recommendations": "日常参考与建议",
  "safety-limitations": "安全提醒与局限",
  "follow-up-questions": "后续追问",
  overview: "内容概览",
  "hook-drivers": "开场与情绪驱动",
  "structure-claims": "结构与核心观点",
  "style-template": "表达风格与复用模板",
  "risks-boundaries": "风险与边界",
};

/**
 * Shows only an event-derived structure projection. This deliberately never
 * renders model reasoning, raw JSON, or an unvalidated medical conclusion.
 */
export function StructuredStreamProgress({ title, progress }: StructuredStreamProgressProps) {
  const description = progress ? phaseCopy[progress.phase] : "正在连接 AI，等待第一个板块开始";
  return (
    <GlassCard aria-live="polite" className="structured-stream-progress" role="status" tone="soft">
      <span className="structured-stream-progress__icon"><Icon name="sync" size={21} /></span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
        {progress ? <div aria-label="生成板块状态" className="structured-stream-progress__sections">{progress.modules.map((module) => <span className={`is-${module.status}`} key={module.moduleId}>{moduleCopy[module.moduleId]} · {module.status === "succeeded" ? "已完成" : module.status === "running" ? "生成中" : module.status === "repairing" ? "校正中" : module.status === "failed" ? "未完成" : "等待生成"}</span>)}</div> : null}
        <small>页面只接收已通过模块校验的状态；原始响应、未闭合 JSON 和模型 reasoning 不会进入界面。</small>
      </div>
    </GlassCard>
  );
}
