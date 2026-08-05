import type { VitalityScanViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { iconName } from "../components/ContentBlocks";
import { PageHeading, SectionHeading } from "../components/Headings";

export interface VitalityScanPageProps {
  readonly viewModel: VitalityScanViewModel;
  readonly navigate: (path: string) => void;
}

export function VitalityScanPage({ viewModel, navigate }: VitalityScanPageProps) {
  return (
    <AppShell activeNav="ai" className="vitality-shell" navigate={navigate} title={viewModel.brand}>
      <div className="page-stack page-vitality-scan">
        <PageHeading eyebrow="VITALITY AI" description={viewModel.description} title={viewModel.title} />
        <GlassCard className="scan-card">
          <div className="scan-card__halo"><span><Icon name="face" size={52} /></span></div>
          <div className="scan-card__corners"><i /><i /><i /><i /></div>
          <p>请将面部或舌部置于取景框内</p>
          <span className="scan-card__hint"><Icon name="sunny" size={15} />保持自然光线，正面拍摄</span>
        </GlassCard>
        <div className="button-row scan-actions"><Button onClick={() => navigate("/vitality/result")}><Icon name="camera" size={18} />{viewModel.scanLabel}</Button><Button onClick={() => navigate("/vitality/result")} variant="secondary"><Icon name="upload_file" size={18} />{viewModel.uploadLabel}</Button></div>

        <section className="page-section">
          <SectionHeading title={viewModel.adviceTitle} />
          <GlassCard className="advice-card">{viewModel.advice.map((item) => <div className="advice-row" key={item.text}><span><Icon name={iconName(item.icon)} size={19} /></span><p>{item.text}</p></div>)}</GlassCard>
        </section>
        <GlassCard className="history-card" onClick={() => navigate("/vitality/result")}><span className="history-card__icon"><Icon name="history" size={22} /></span><div><strong>{viewModel.historyTitle}</strong><p>{viewModel.historyDescription}</p></div><Icon name="chevron_right" size={19} /></GlassCard>
      </div>
    </AppShell>
  );
}
