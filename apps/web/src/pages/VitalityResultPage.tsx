import type { VitalityResultViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { iconName } from "../components/ContentBlocks";
import { PageHeading, SectionHeading } from "../components/Headings";
import { MediaFrame } from "../components/MediaFrame";

export interface VitalityResultPageProps {
  readonly viewModel: VitalityResultViewModel;
  readonly navigate: (path: string) => void;
}

export function VitalityResultPage({ viewModel, navigate }: VitalityResultPageProps) {
  return (
    <AppShell activeNav="ai" backPath="/vitality/scan" className="vitality-shell" navigate={navigate} title={viewModel.title} visualTheme="warm-soft-tech">
      <div className="page-stack page-vitality-result">
        <PageHeading description={viewModel.overviewDescription} title={viewModel.overviewTitle} />
        <GlassCard className="static-observation-overview-card">
          <span className="status-badge status-badge--completed"><Icon name="check_circle" size={15} />{viewModel.completedLabel}</span>
          <p>此视觉夹具不提供任何评分或结论；真实页面只读取本地保存的正式报告。</p>
        </GlassCard>

        <div className="vitality-media-grid">
          <GlassCard className="vitality-media-card"><MediaFrame media={viewModel.faceMedia} /><div><strong>{viewModel.faceTitle}</strong><span>AI 视觉观察</span></div></GlassCard>
          <GlassCard className="vitality-media-card"><MediaFrame media={viewModel.tongueMedia} /><div><strong>{viewModel.tongueTitle}</strong><span>AI 视觉观察</span></div></GlassCard>
        </div>

        <section className="page-section">
          <SectionHeading title="面部与舌象观察" />
          <div className="observation-grid">
            {[...viewModel.faceObservations, ...viewModel.tongueObservations].map((item) => <GlassCard className="observation-card" key={item.label}><span>{item.label}</span><strong>{item.value}</strong></GlassCard>)}
          </div>
        </section>

        <section className="page-section">
          <SectionHeading title={viewModel.recommendationTitle} />
          <GlassCard className="recommendation-card">{viewModel.recommendations.map((item) => <div className="recommendation-row" key={item.text}><span><Icon name={iconName(item.icon)} size={18} /></span><p>{item.text}</p></div>)}</GlassCard>
        </section>

        <div className="button-row vitality-result__actions"><Button onClick={() => undefined} variant="secondary"><Icon name="download" size={17} />{viewModel.saveLabel}</Button><Button onClick={() => undefined}><Icon name="forum" size={17} />{viewModel.consultLabel}</Button></div>
        <p className="medical-note">本页面为静态视觉骨架，内容仅用于展示，不构成医疗建议。</p>
      </div>
    </AppShell>
  );
}
