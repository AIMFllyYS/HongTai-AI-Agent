import type { HomeViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { RecentAnalysisList, iconName } from "../components/ContentBlocks";
import { PageHeading, SectionHeading } from "../components/Headings";

export interface HomePageProps {
  readonly viewModel: HomeViewModel;
  readonly navigate: (path: string) => void;
}

export function HomePage({ viewModel, navigate }: HomePageProps) {
  return (
    <AppShell activeNav="home" navigate={navigate} subtitle="AI 视频内容工作台" title="宏泰AI智能体">
      <div className="page-stack page-home">
        <PageHeading
          className="page-home__heading"
          description={viewModel.subtitle}
          title={viewModel.title}
        />

        <GlassCard className="input-card">
          <label className="field-label" htmlFor="analysis-url">{viewModel.inputTitle}</label>
          <div className="input-card__control">
            <Icon name="link" size={20} />
            <input id="analysis-url" placeholder={viewModel.inputPlaceholder} type="url" />
            <button aria-label="粘贴链接" className="input-card__paste" type="button"><Icon name="content_paste" size={18} /></button>
          </div>
          <p className="field-hint">{viewModel.inputHint}</p>
          <Button className="input-card__submit" icon={<Icon name="rocket" size={18} />} onClick={() => navigate("/analyze/processing")}>
            {viewModel.primaryActionLabel}
          </Button>
        </GlassCard>

        <section className="page-section">
          <SectionHeading title="AI 能力" />
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
          <SectionHeading action={<button className="text-action" onClick={() => navigate("/analyze/result")} type="button">查看全部</button>} title={viewModel.recentTitle} />
          <RecentAnalysisList items={viewModel.recent} navigate={navigate} />
        </section>

        <GlassCard className="home-tip" tone="soft">
          <Icon name="lightbulb" size={22} />
          <div><strong>从一条链接开始</strong><p>静态演示数据由可替换 adapter 提供，后续可接入真实任务查询。</p></div>
        </GlassCard>
      </div>
    </AppShell>
  );
}
