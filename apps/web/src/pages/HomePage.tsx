import { useState } from "react";

import type { HomeViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { RecentAnalysisList, iconName } from "../components/ContentBlocks";
import { PageHeading, SectionHeading } from "../components/Headings";
import { EmptyState } from "../components/StatePanels";

export interface HomePageProps {
  readonly viewModel: HomeViewModel;
  readonly navigate: (path: string) => void;
}

export function HomePage({ viewModel, navigate }: HomePageProps) {
  const [showEmptyState, setShowEmptyState] = useState(false);

  return (
    <AppShell activeNav="home" navigate={navigate} title="宏泰AI智能体">
      <div className="page-stack page-home">
        <PageHeading
          className="page-home__heading"
          description={viewModel.subtitle}
          title={viewModel.title}
        />

        <GlassCard className="input-card">
          <label className="field-label" htmlFor="analysis-url"><Icon name="link" size={20} />{viewModel.inputTitle}</label>
          <div className="input-card__control">
            <input id="analysis-url" placeholder={viewModel.inputPlaceholder} type="url" />
            <button aria-label="粘贴链接" className="input-card__paste" type="button"><Icon name="content_paste" size={18} /></button>
          </div>
          <p className="field-hint"><Icon name="info" size={16} />{viewModel.inputHint}</p>
          <Button className="input-card__submit" icon={<Icon name="bolt" size={19} />} onClick={() => navigate("/analyze/processing")} size="lg">
            {viewModel.primaryActionLabel}
          </Button>
        </GlassCard>

        <section className="page-section">
          <div className="capability-grid">
            {viewModel.capabilities.map((tile) => (
              <GlassCard className={`capability-tile capability-tile--${tile.tone}`} key={tile.id}>
                <span className="capability-tile__icon"><Icon name={iconName(tile.icon)} size={22} /></span>
                <strong>{tile.title}</strong>
              </GlassCard>
            ))}
          </div>
        </section>

        <section className="page-section">
          <SectionHeading action={<button aria-pressed={showEmptyState} className="text-action" onClick={() => setShowEmptyState((current) => !current)} type="button">{viewModel.recentToggleLabel}</button>} title={viewModel.recentTitle} />
          {showEmptyState ? <EmptyState action={<Button className="home-empty__action" onClick={() => setShowEmptyState(false)} variant="secondary">{viewModel.emptyActionLabel}</Button>} description={viewModel.emptyDescription} title={viewModel.emptyTitle} /> : <RecentAnalysisList items={viewModel.recent} navigate={navigate} />}
        </section>
      </div>
    </AppShell>
  );
}
