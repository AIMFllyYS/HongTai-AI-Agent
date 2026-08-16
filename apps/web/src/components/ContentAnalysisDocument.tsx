import type { TaskEvidenceUnit } from "@hongtai/core";

import { EmptyState } from "./StatePanels";
import { GlassCard } from "./GlassCard";
import { Icon } from "./Icon";
import { SectionHeading } from "./Headings";
import type { ContentAnalysisView } from "../features/tasks/content-analysis-presenters";

export interface ContentAnalysisDocumentProps {
  readonly analysis: ContentAnalysisView;
  readonly evidenceUnits: readonly TaskEvidenceUnit[];
}

function evidenceAnchor(id: string): string {
  return `analysis-evidence-${encodeURIComponent(id)}`;
}

function EvidenceRefs({ refs, evidence }: { readonly refs: readonly string[]; readonly evidence: ReadonlyMap<string, TaskEvidenceUnit> }) {
  if (refs.length === 0) return <span className="analysis-evidence-refs__empty">未关联展示证据</span>;
  return (
    <div className="analysis-evidence-refs">
      {refs.map((id) => evidence.has(id)
        ? <a href={`#${evidenceAnchor(id)}`} key={id}>证据 {id}</a>
        : <span key={id}>证据 {id} 暂不可展示</span>)}
    </div>
  );
}

function InsightList({
  items,
  evidence,
  emptyTitle,
}: {
  readonly items: readonly { readonly description: string; readonly evidenceRefs: readonly string[] }[];
  readonly evidence: ReadonlyMap<string, TaskEvidenceUnit>;
  readonly emptyTitle: string;
}) {
  if (items.length === 0) return <EmptyState className="analysis-document__empty" description="正式结果没有列出这一项，不会用演示内容补齐。" icon="info" title={emptyTitle} />;
  return (
    <div className="analysis-insight-list">
      {items.map((item, index) => (
        <article className="analysis-insight" key={`${item.description}-${index}`}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <div><p>{item.description}</p><EvidenceRefs evidence={evidence} refs={item.evidenceRefs} /></div>
        </article>
      ))}
    </div>
  );
}

function StringChips({ values, empty }: { readonly values: readonly string[]; readonly empty: string }) {
  if (values.length === 0) return <span className="analysis-evidence-refs__empty">{empty}</span>;
  return <div className="analysis-chip-row">{values.map((item) => <span className="analysis-chip" key={item}>{item}</span>)}</div>;
}

/** Displays the formal content-analysis.v1 projection and its actual evidence only. */
export function ContentAnalysisDocument({ analysis, evidenceUnits }: ContentAnalysisDocumentProps) {
  const evidence = new Map(evidenceUnits.map((item) => [item.id, item]));
  return (
    <div className="analysis-document">
      <section className="page-section">
        <SectionHeading title="概览" />
        {analysis.overview ? (
          <GlassCard className="analysis-overview">
            <p>{analysis.overview.summary}</p>
            <dl>
              <div><dt>主题</dt><dd>{analysis.overview.theme}</dd></div>
              {analysis.overview.communicationGoal ? <div><dt>沟通目标</dt><dd>{analysis.overview.communicationGoal}</dd></div> : null}
            </dl>
            <StringChips empty="未列出目标受众" values={analysis.overview.targetAudiences} />
          </GlassCard>
        ) : <EmptyState className="analysis-document__empty" description="正式结果没有可展示的概览字段。" icon="info" title="暂无概览" />}
      </section>

      <section className="page-section">
        <SectionHeading title="开场钩子" />
        {analysis.hook ? (
          <GlassCard className="analysis-hook">
            <span className="analysis-hook__icon"><Icon name="bolt" size={22} /></span>
            <div><strong>{analysis.hook.description}</strong>{analysis.hook.mechanism ? <p>{analysis.hook.mechanism}</p> : null}{analysis.hook.type ? <small>类型：{analysis.hook.type}</small> : null}<EvidenceRefs evidence={evidence} refs={analysis.hook.evidenceRefs} /></div>
          </GlassCard>
        ) : <EmptyState className="analysis-document__empty" description="正式结果没有列出开场钩子。" icon="info" title="暂无钩子结论" />}
      </section>

      <section className="page-section">
        <SectionHeading title="痛点与情绪驱动" />
        <GlassCard className="analysis-split-card">
          <div><h4>痛点</h4><InsightList emptyTitle="暂无痛点结论" evidence={evidence} items={analysis.painPoints} /></div>
          <div><h4>情绪驱动</h4><InsightList emptyTitle="暂无情绪驱动结论" evidence={evidence} items={analysis.emotionalDrivers} /></div>
        </GlassCard>
      </section>

      <section className="page-section">
        <SectionHeading action={<span className="analysis-count">{analysis.structure.length} 个结构段</span>} title="内容结构" />
        {analysis.structure.length === 0 ? <EmptyState className="analysis-document__empty" description="正式结果没有列出内容结构。" icon="info" title="暂无结构结论" /> : (
          <div className="analysis-structure-list">
            {analysis.structure.map((item) => (
              <GlassCard className="analysis-structure" key={`${item.order}-${item.summary}`}>
                <span>{String(item.order).padStart(2, "0")}</span>
                <div><div className="analysis-structure__title"><strong>{item.summary}</strong>{item.role ? <small>{item.role}</small> : null}</div><StringChips empty="未列出技巧" values={item.techniques} /><EvidenceRefs evidence={evidence} refs={item.evidenceRefs} /></div>
              </GlassCard>
            ))}
          </div>
        )}
      </section>

      <section className="page-section">
        <SectionHeading title="核心论点" />
        {analysis.coreClaims.length === 0 ? <EmptyState className="analysis-document__empty" description="正式结果没有列出可追溯的论点。" icon="info" title="暂无论点结论" /> : (
          <div className="analysis-claim-list">
            {analysis.coreClaims.map((item) => <GlassCard className="analysis-claim" key={item.claim}><p>{item.claim}</p><div>{item.supportLevel ? <span>{item.supportLevel === "explicit" ? "原文明确表达" : "基于证据推断"}</span> : null}<EvidenceRefs evidence={evidence} refs={item.evidenceRefs} /></div></GlassCard>)}
          </div>
        )}
      </section>

      <section className="page-section">
        <SectionHeading title="表达风格" />
        {analysis.style ? (
          <GlassCard className="analysis-style-card">
            {analysis.style.pacing ? <div><span>节奏</span><strong>{analysis.style.pacing}</strong></div> : null}
            <div><span>语气</span><StringChips empty="未列出语气" values={analysis.style.tones} /></div>
            <div><span>语言模式</span><StringChips empty="未列出语言模式" values={analysis.style.languagePatterns} /></div>
            <div><span>互动机制</span><StringChips empty="未列出互动机制" values={analysis.style.interactionMechanisms} /></div>
          </GlassCard>
        ) : <EmptyState className="analysis-document__empty" description="正式结果没有可展示的风格字段。" icon="info" title="暂无风格结论" />}
      </section>

      <section className="page-section">
        <SectionHeading title="可复用模板" />
        {analysis.reusableTemplate ? (
          <GlassCard className="analysis-template-card">
            <span className="analysis-template-card__icon"><Icon name="auto_awesome" size={24} /></span>
            <div><strong>{analysis.reusableTemplate.formula}</strong><ol>{analysis.reusableTemplate.steps.map((step) => <li key={step}>{step}</li>)}</ol><div><small>可变槽位</small><StringChips empty="未列出可变槽位" values={analysis.reusableTemplate.variableSlots} /></div><div><small>不可照搬</small><StringChips empty="未列出风险提示" values={analysis.reusableTemplate.doNotCopy} /></div></div>
          </GlassCard>
        ) : <EmptyState className="analysis-document__empty" description="正式结果没有给出可复用模板。" icon="info" title="暂无模板" />}
      </section>

      <section className="page-section">
        <SectionHeading title="风险与边界" />
        {analysis.risks.length === 0 ? <EmptyState className="analysis-document__empty" description="正式结果没有列出风险项。" icon="info" title="暂无风险项" /> : <InsightList emptyTitle="暂无风险项" evidence={evidence} items={analysis.risks} />}
      </section>

      <section className="page-section" id="analysis-evidence">
        <SectionHeading action={<span className="analysis-count">{evidenceUnits.length} 条真实证据</span>} title="证据" />
        {evidenceUnits.length === 0 ? <EmptyState className="analysis-document__empty" description="任务详情没有可展示的文稿或图文证据。" icon="folder_open" title="暂无证据" /> : (
          <div className="analysis-evidence-list">
            {evidenceUnits.map((item) => <GlassCard className="analysis-evidence" id={evidenceAnchor(item.id)} key={item.id}><span>{item.source === "transcript" ? "文稿" : "图文"}</span><div><small>{item.id}{item.startSeconds === undefined ? "" : ` · ${item.startSeconds}s`}{item.endSeconds === undefined ? "" : `–${item.endSeconds}s`}</small><p>{item.text}</p></div></GlassCard>)}
          </div>
        )}
      </section>
    </div>
  );
}
