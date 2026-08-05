import type { ProcessingViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { ProgressSteps } from "../components/ProgressSteps";
import { RecentAnalysisList } from "../components/ContentBlocks";
import { SectionHeading } from "../components/Headings";

export interface ProcessingPageProps {
  readonly viewModel: ProcessingViewModel;
  readonly navigate: (path: string) => void;
}

export function ProcessingPage({ viewModel, navigate }: ProcessingPageProps) {
  return (
    <AppShell activeNav="home" backPath="/" navigate={navigate} title="拆解任务">
      <div className="page-stack page-processing">
        <section className="processing-hero">
          <span className="processing-hero__orb"><Icon name="sync" size={34} /></span>
          <h2>{viewModel.title}</h2>
          <p>{viewModel.currentDescription}</p>
          <span className="processing-hero__input"><Icon name="link" size={15} />{viewModel.input}</span>
        </section>

        <GlassCard className="progress-card">
          <div className="progress-card__header"><div><span className="eyebrow">DOWNLOAD</span><strong>媒体准备进度</strong></div><strong className="progress-card__percent">{viewModel.downloadProgress}%</strong></div>
          <span className="progress-bar progress-bar--large"><span style={{ width: `${viewModel.downloadProgress}%` }} /></span>
          <p className="progress-card__summary">{viewModel.downloadSummary}</p>
        </GlassCard>

        <GlassCard className="steps-card">
          <SectionHeading title="处理进度" action={<span className="live-indicator"><i />进行中</span>} />
          <ProgressSteps steps={viewModel.steps} />
        </GlassCard>

        <Button className="wide-action" onClick={() => navigate("/")} variant="quiet"><Icon name="close" size={17} />{viewModel.cancelLabel}</Button>

        <section className="page-section page-section--muted">
          <SectionHeading title="最近拆解" />
          <RecentAnalysisList compact items={viewModel.recent.slice(0, 2)} navigate={navigate} />
        </section>
      </div>
    </AppShell>
  );
}
