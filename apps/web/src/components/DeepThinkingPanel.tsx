import { useEffect, useRef, useState } from "react";

import type { StructuredGenerationThinkingV1 } from "@hongtai/core";

import { Icon } from "./Icon";

export interface DeepThinkingPanelProps {
  readonly thinking: StructuredGenerationThinkingV1;
  readonly variant?: "analysis" | "observation";
}

const statusCopy: Readonly<Record<StructuredGenerationThinkingV1["status"], string>> = {
  waiting: "等待模型开始思考",
  streaming: "正在实时思考",
  completed: "思考已完成",
};

function emptyCopy(status: StructuredGenerationThinkingV1["status"]): string {
  return status === "completed"
    ? "模型本次没有返回可展示的深度思考文本。"
    : "连接建立后，这里会实时显示模型返回的深度思考。";
}

export function DeepThinkingPanel({ thinking, variant = "analysis" }: DeepThinkingPanelProps) {
  const [open, setOpen] = useState(thinking.status === "streaming");
  const contentRef = useRef<HTMLPreElement>(null);
  const observation = variant === "observation";
  const footnote = observation
    ? "推理内容仅在本次生成期间显示，不会保存"
    : "推理内容仅在本次生成期间显示，不会保存到任务或历史。";

  useEffect(() => {
    if (thinking.status === "streaming") setOpen(true);
    if (thinking.status === "completed") setOpen(false);
  }, [thinking.status]);

  useEffect(() => {
    if (!open || !contentRef.current) return;
    contentRef.current.scrollTop = contentRef.current.scrollHeight;
  }, [open, thinking.text]);

  return (
    <details
      className={`deep-thinking-panel deep-thinking-panel--${variant} is-${thinking.status}`}
      data-thinking-status={thinking.status}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary>
        <span className="deep-thinking-panel__signal"><Icon name={observation ? "sparkles" : "memory"} size={18} /></span>
        {observation ? (
          <>
            <strong className="deep-thinking-panel__title">深度思考</strong>
            <small className="deep-thinking-panel__status">{statusCopy[thinking.status]}</small>
          </>
        ) : (
          <span className="deep-thinking-panel__heading"><strong>深度思考</strong><small>{statusCopy[thinking.status]}</small></span>
        )}
        <Icon className="deep-thinking-panel__chevron" name="chevron_down" size={18} />
      </summary>
      <div className="deep-thinking-panel__content">
        <pre aria-live="off" ref={contentRef}>{thinking.text || emptyCopy(thinking.status)}</pre>
        <small>{observation ? null : <Icon name="info" size={14} />}{footnote}</small>
      </div>
    </details>
  );
}
