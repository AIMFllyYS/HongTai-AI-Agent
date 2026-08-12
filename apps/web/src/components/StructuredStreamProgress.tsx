import type { StructuredStreamProgress as StructuredStreamProgressValue } from "@hongtai/core";

import { GlassCard } from "./GlassCard";
import { Icon } from "./Icon";

export interface StructuredStreamProgressProps {
  readonly title: string;
  readonly progress?: StructuredStreamProgressValue;
}

const phaseCopy: Readonly<Record<StructuredStreamProgressValue["phase"], string>> = {
  receiving: "正在接收真实结构化内容",
  validating: "内容已接收，正在校验正式结构",
  repairing: "正在修复未通过校验的结构",
};

/**
 * Shows only an event-derived structure projection. This deliberately never
 * renders model reasoning, raw JSON, or an unvalidated medical conclusion.
 */
export function StructuredStreamProgress({ title, progress }: StructuredStreamProgressProps) {
  const description = progress ? phaseCopy[progress.phase] : "正在连接 AI，等待真实结构化内容返回";
  return (
    <GlassCard aria-live="polite" className="structured-stream-progress" role="status" tone="soft">
      <span className="structured-stream-progress__icon"><Icon name="sync" size={21} /></span>
      <div>
        <strong>{title}</strong>
        <p>{description}{progress ? ` · 已接收 ${progress.receivedCharacters} 个字符` : null}</p>
        {progress?.sections.length ? <div aria-label="已接收的结构区块" className="structured-stream-progress__sections">{progress.sections.map((section) => <span key={section}>{section}</span>)}</div> : null}
        {progress?.highlights.length ? <ul className="structured-stream-progress__highlights">{progress.highlights.map((item) => <li key={item.label}><strong>{item.label}</strong><span>{item.value}</span></li>)}</ul> : null}
        <small>这是本次真实流事件的结构投影，尚未保存为正式结果；不会展示模型 reasoning 或原始响应。</small>
      </div>
    </GlassCard>
  );
}
