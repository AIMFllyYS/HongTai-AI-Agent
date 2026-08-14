import type { StructuredGenerationProgressV1, TaskIssue } from "@hongtai/core";

import {
  buildValidatedModuleRows,
  type ValidatedModuleContent,
  type ValidatedModuleDefinition,
  type ValidatedModuleRow,
} from "../features/generation/validated-module-progress";
import { DeepThinkingPanel } from "./DeepThinkingPanel";
import { GlassCard } from "./GlassCard";
import { Icon, type IconName } from "./Icon";
import { issueTitle } from "./IssueNotice";

export interface ValidatedModuleProgressProps {
  readonly title: string;
  readonly failedTitle?: string;
  readonly definitions: readonly ValidatedModuleDefinition[];
  readonly progress?: StructuredGenerationProgressV1;
  readonly issue?: TaskIssue;
}

const phaseCopy: Readonly<Record<StructuredGenerationProgressV1["phase"], string>> = {
  preparing: "正在准备内容",
  generating: "AI 正在整理和分析",
  validating: "正在检查结果是否完整",
  saving: "正在保存结果",
};

const waitingThinking = { status: "waiting", text: "" } as const;

function statusIcon(row: ValidatedModuleRow): IconName {
  if (row.status === "succeeded") return "check_circle";
  if (row.status === "failed") return "error";
  if (row.active) return "sync";
  return "pending";
}

function ModuleContent({ content }: { readonly content: ValidatedModuleContent }) {
  return (
    <div aria-live="off" className="validated-module-progress__result">
      {content.lead ? <p className="validated-module-progress__lead">{content.lead}</p> : null}
      {content.facts?.length ? <dl className="validated-module-progress__facts">{content.facts.map((fact) => <div key={`${fact.label}:${fact.value}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl> : null}
      {content.groups?.map((group) => group.items.length ? (
        <section className="validated-module-progress__group" key={group.title}>
          <strong>{group.title}</strong>
          <ul>{group.items.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul>
        </section>
      ) : null)}
      {content.note ? <p className="validated-module-progress__note">{content.note}</p> : null}
    </div>
  );
}

export function ValidatedModuleProgress({ title, failedTitle, definitions, progress, issue }: ValidatedModuleProgressProps) {
  const rows = buildValidatedModuleRows(definitions, progress, issue);
  const completed = rows.filter((row) => row.status === "succeeded").length;
  const active = rows.find((row) => row.active);
  const failed = rows.find((row) => row.status === "failed");
  const description = failed
    ? `${failed.title}没有完成，后续内容暂未开始`
    : progress ? phaseCopy[progress.phase] : "正在连接 AI，请稍候";
  const busy = rows.some((row) => row.showSkeleton) || progress?.phase === "saving";

  return (
    <GlassCard
      aria-busy={busy}
      className="validated-module-progress"
      data-generation-flow={progress?.flow}
      tone="soft"
    >
      <header className="validated-module-progress__header">
        <span className="validated-module-progress__mark"><Icon name={progress?.phase === "saving" ? "folder_special" : "auto_awesome"} size={22} /></span>
        <div>
          <strong>{failed ? failedTitle ?? "本次生成未完成" : title}</strong>
          <p>{description}</p>
        </div>
        <span className="validated-module-progress__count">{completed}/{rows.length} 项已完成</span>
      </header>

      <p aria-atomic="true" aria-live="polite" className="validated-module-progress__announcement" role="status">{active ? `${active.title}：${active.statusLabel}` : description}</p>

      <DeepThinkingPanel thinking={progress?.thinking ?? waitingThinking} />

      <ol className="validated-module-progress__list">
        {rows.map((row, index) => (
          <li
            className={`validated-module-progress__module is-${row.status} ${row.active ? "is-active" : ""}`.trim()}
            data-module-id={row.moduleId}
            data-module-status={row.status}
            key={row.moduleId}
          >
            <span className="validated-module-progress__index">{String(index + 1).padStart(2, "0")}</span>
            <span className="validated-module-progress__status-icon"><Icon name={statusIcon(row)} size={19} /></span>
            <div className="validated-module-progress__body">
              <div className="validated-module-progress__module-heading">
                <strong>{row.title}</strong>
                <span>{row.statusLabel}</span>
              </div>

              {row.showSkeleton ? (
                <div aria-hidden="true" className="validated-module-progress__skeleton">
                  <span className="validated-module-progress__skeleton-bar" />
                  <span className="validated-module-progress__skeleton-bar" />
                  <span className="validated-module-progress__skeleton-bar" />
                </div>
              ) : null}

              {row.content ? <ModuleContent content={row.content} /> : null}

              {row.status === "failed" ? (
                <div className="validated-module-progress__failure">
                  <p>{row.issue ? issueTitle(row.issue) : "这一部分没有完成，后续内容暂未开始。"}</p>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <footer className="validated-module-progress__footer">
        <Icon name="info" size={16} />
        <span>分析过程只在本次运行中显示，完成后的结果会自动保存在本机。</span>
      </footer>
    </GlassCard>
  );
}
