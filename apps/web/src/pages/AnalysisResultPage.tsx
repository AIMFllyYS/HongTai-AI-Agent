import type { AnalysisResultViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { PageHeading, SectionHeading } from "../components/Headings";
import { TabPanel, Tabs, tabId, tabPanelId } from "../components/Tabs";
import { MediaFrame } from "../components/MediaFrame";

export interface AnalysisResultPageProps {
  readonly viewModel: AnalysisResultViewModel;
  readonly navigate: (path: string) => void;
}

export function AnalysisResultPage({ viewModel, navigate }: AnalysisResultPageProps) {
  const tabsId = "analysis-result-tabs";
  const activeTabIndex = Math.max(0, viewModel.tabs.indexOf(viewModel.activeTab));

  return (
    <AppShell
      activeNav="home"
      backPath="/"
      headerAction={<button aria-label="下载报告" className="icon-button" type="button"><Icon name="download" size={21} /></button>}
      navigate={navigate}
      title="拆解结果"
    >
      <div className="page-stack page-result">
        <PageHeading description={viewModel.intro} title={viewModel.title} />
        <GlassCard className="result-media-card">
          <MediaFrame media={viewModel.media} showPlay>
            <span className="media-overlay-label">{viewModel.duration} · {viewModel.viewCount}</span>
          </MediaFrame>
          <div className="result-media-card__footer"><span><Icon name="analytics" size={16} />爆款结构分析</span><button className="icon-button" type="button"><Icon name="bookmark" size={19} /></button></div>
        </GlassCard>

        <Tabs active={viewModel.activeTab} id={tabsId} panelId={tabPanelId(tabsId)} tabs={viewModel.tabs} />

        <TabPanel className="page-stack" id={tabPanelId(tabsId)} labelledBy={tabId(tabsId, activeTabIndex)}>
          <section className="page-section">
            <SectionHeading action={<span className="analysis-count">{viewModel.timeline.length} 个关键片段</span>} title="内容结构" />
            <div className="timeline-list">
              {viewModel.timeline.map((item, index) => (
                <article className={`timeline-item timeline-item--${item.tone}`} key={item.id}>
                  <div className="timeline-item__rail"><span>{String(index + 1).padStart(2, "0")}</span></div>
                  <div className="timeline-item__body">
                    <div className="timeline-item__title"><strong>{item.label}</strong><time>{item.timeRange}</time></div>
                    <p>{item.description}</p>
                    {item.tags ? <div className="chip-row">{item.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div> : null}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <GlassCard className="template-card" tone="soft">
            <div className="template-card__icon"><Icon name="auto_awesome" size={25} /></div>
            <div className="template-card__body"><span className="eyebrow">REUSABLE TEMPLATE</span><h3>{viewModel.templateTitle}</h3><p>{viewModel.templateDescription}</p>{viewModel.templateMeta.map((meta) => <span className="template-meta" key={meta.label}><b>{meta.label}</b>{meta.value}</span>)}</div>
            <Button className="wide-action" onClick={() => navigate("/create")}><Icon name="movie_edit" size={17} />{viewModel.templateAction}</Button>
          </GlassCard>

          <div className="button-row">
            <Button onClick={() => navigate("/create")} variant="secondary"><Icon name="auto_awesome" size={17} />{viewModel.saveAction}</Button>
            <Button onClick={() => navigate("/analyze/processing")} variant="quiet"><Icon name="sync" size={17} />{viewModel.retryAction}</Button>
          </div>
        </TabPanel>
      </div>
    </AppShell>
  );
}
