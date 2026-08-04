import type { PublishViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { PageHeading, SectionHeading, iconName } from "../components/PageBlocks";
import { MediaFrame } from "../components/MediaFrame";

export interface PublishPageProps {
  readonly viewModel: PublishViewModel;
  readonly navigate: (path: string) => void;
}

export function PublishPage({ viewModel, navigate }: PublishPageProps) {
  return (
    <AppShell backPath="/create" navigate={navigate} title={viewModel.title}>
      <div className="page-stack page-publish">
        <PageHeading description="确认视频内容与发布渠道" title={viewModel.title} />
        <GlassCard className="publish-preview-card">
          <MediaFrame media={viewModel.media} showPlay><span className="media-overlay-label">AI GENERATED · 00:32</span></MediaFrame>
          <div className="publish-preview-card__footer"><span><Icon name="check_circle" size={17} />生成成功</span><button aria-label="下载视频" className="icon-button" type="button"><Icon name="download" size={19} /></button></div>
        </GlassCard>

        <section className="page-section">
          <SectionHeading title={viewModel.platformsTitle} />
          <div className="platform-grid">
            {viewModel.platforms.map((platform, index) => <button className={`platform-card ${index === 0 ? "is-selected" : ""}`.trim()} key={platform.id} onClick={() => undefined} type="button"><span className="platform-card__icon"><Icon name={iconName(platform.icon)} size={22} /></span><strong>{platform.label}</strong>{index === 0 ? <span className="platform-card__check"><Icon name="check_circle" size={17} /></span> : null}</button>)}
          </div>
          <p className="field-hint field-hint--center"><Icon name="info" size={14} />{viewModel.hint}</p>
        </section>

        <div className="button-stack">
          <Button onClick={() => undefined}><Icon name="publish" size={18} />{viewModel.primaryAction}</Button>
          <div className="button-row">{viewModel.secondaryActions.map((action, index) => <Button key={action} onClick={() => navigate(index === 0 ? "/assets" : "/create")} variant="quiet">{action}</Button>)}</div>
        </div>
      </div>
    </AppShell>
  );
}
