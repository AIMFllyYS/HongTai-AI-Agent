import type { DetailViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { Chip, MetricGrid, PageHeading, SectionHeading, Tabs } from "../components/PageBlocks";
import { MediaFrame } from "../components/MediaFrame";

export interface DetailPageProps {
  readonly viewModel: DetailViewModel;
  readonly navigate: (path: string) => void;
}

export function DetailPage({ viewModel, navigate }: DetailPageProps) {
  const isGallery = viewModel.variant === "gallery";
  return (
    <AppShell
      backPath="/analyze/result"
      headerAction={<button aria-label="更多操作" className="icon-button" type="button"><Icon name="share" size={21} /></button>}
      navigate={navigate}
      title={viewModel.title}
    >
      <div className="page-stack page-detail">
        <GlassCard className="detail-media-card">
          <MediaFrame media={viewModel.media} showPlay>
            <span className="media-overlay-label">{viewModel.duration}</span>
          </MediaFrame>
          <div className="detail-media-card__body">
            <div className="detail-media-card__title"><div><h2>{viewModel.contentTitle}</h2><p>{viewModel.author}</p></div><span className="detail-media-card__status">{viewModel.statusLabel}</span></div>
            <span className="detail-media-card__platform"><Icon name={isGallery ? "grid" : "video_file"} size={15} />{viewModel.platformLabel}</span>
          </div>
        </GlassCard>

        {isGallery && viewModel.gallery ? (
          <GlassCard className="gallery-preview-card">
            <SectionHeading action={<span className="text-action">{viewModel.gallery.countLabel}</span>} title={viewModel.gallery.title} />
            <MediaFrame media={viewModel.gallery.media} />
            <div className="gallery-preview-card__meta"><span><b>{viewModel.gallery.sizeLabel}</b>素材大小</span><span><b>{viewModel.gallery.durationLabel}</b>动效时长</span><Button onClick={() => undefined} variant="secondary"><Icon name="download" size={16} />{viewModel.gallery.saveLabel}</Button></div>
          </GlassCard>
        ) : null}

        <MetricGrid items={viewModel.metrics} />
        <Tabs active={viewModel.activeTab} tabs={viewModel.tabs} />

        <GlassCard className="detail-content-card">
          <PageHeading description={viewModel.analysisIntro} title="AI 自动拆解" />
          <section className="transcript-list">
            <SectionHeading title={isGallery ? "图文结构" : "原始文稿"} />
            {viewModel.transcript.map((line) => <div className="transcript-line" key={line.time}><time>{line.time}</time><p>{line.text}</p></div>)}
          </section>
          <section className="page-section">
            <SectionHeading title="关键片段" />
            <div className="timeline-list timeline-list--compact">{viewModel.timeline.slice(0, 3).map((item) => <article className={`timeline-item timeline-item--${item.tone}`} key={item.id}><div className="timeline-item__rail"><Icon name="check_circle" size={16} /></div><div className="timeline-item__body"><div className="timeline-item__title"><strong>{item.label}</strong><time>{item.timeRange}</time></div><p>{item.description}</p></div></article>)}</div>
          </section>
          <div className="chip-row detail-tags">{viewModel.tags.map((tag) => <Chip key={tag}>{tag}</Chip>)}</div>
        </GlassCard>
      </div>
    </AppShell>
  );
}
