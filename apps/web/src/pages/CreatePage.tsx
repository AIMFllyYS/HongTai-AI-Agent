import type { CreateViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { Chip } from "../components/ContentBlocks";
import { PageHeading, SectionHeading } from "../components/Headings";
import { MediaFrame } from "../components/MediaFrame";

export interface CreatePageProps {
  readonly viewModel: CreateViewModel;
  readonly navigate: (path: string) => void;
}

export function CreatePage({ viewModel, navigate }: CreatePageProps) {
  return (
    <AppShell activeNav="create" navigate={navigate} title={viewModel.title}>
      <div className="page-stack page-create">
        <PageHeading description="选择一个模板，把你的想法变成可发布的视频。" title={viewModel.title} />
        <GlassCard className="prompt-card">
          <label className="field-label" htmlFor="create-prompt">{viewModel.promptLabel}</label>
          <textarea id="create-prompt" placeholder={viewModel.promptPlaceholder} rows={4} />
          <div className="prompt-card__footer"><span><Icon name="auto_awesome" size={16} />AI 会自动匹配素材</span><Button onClick={() => navigate("/publish")}><Icon name="rocket" size={17} />{viewModel.actionLabel}</Button></div>
        </GlassCard>

        <section className="page-section">
          <SectionHeading title={viewModel.profileTitle} />
          <GlassCard className="profile-tags-card" tone="soft"><Icon name="business_center" size={22} /><div className="chip-row">{viewModel.profileTags.map((tag) => <Chip key={tag} selected>{tag}</Chip>)}</div><Icon name="chevron_right" size={19} /></GlassCard>
        </section>

        <section className="page-section">
          <SectionHeading action={<button className="text-action" type="button">{viewModel.templateMoreLabel}</button>} title={viewModel.templateTitle} />
          <div className="template-scroller">
            {viewModel.templates.map((template) => (
              <button className={`template-tile ${template.selected ? "is-selected" : ""}`.trim()} key={template.id} onClick={() => undefined} type="button">
                <MediaFrame media={template.media} />
                {template.selected ? <span className="template-tile__selected"><Icon name="check_circle" size={18} /></span> : null}
                <span className="template-tile__body"><strong>{template.title}</strong><small>{template.description}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="page-section">
          <SectionHeading title={viewModel.materialTitle} />
          <div className="chip-row">{viewModel.materialFilters.map((filter, index) => <Chip key={filter} selected={index === 0}>{filter}</Chip>)}</div>
          <GlassCard className="generation-card" tone="soft"><span className="generation-card__orb"><Icon name="sync" size={25} /></span><div><strong>{viewModel.generationTitle}</strong><p>{viewModel.generationDescription}</p><small>{viewModel.generationEta}</small></div></GlassCard>
        </section>
      </div>
    </AppShell>
  );
}
