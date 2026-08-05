import type { AssetsViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { Chip } from "../components/ContentBlocks";
import { PageHeading, SectionHeading } from "../components/Headings";
import { TabPanel, Tabs, tabId, tabPanelId } from "../components/Tabs";
import { MediaFrame } from "../components/MediaFrame";
import { StatusBadge } from "../components/StatusBadge";

export interface AssetsPageProps {
  readonly viewModel: AssetsViewModel;
  readonly navigate: (path: string) => void;
}

export function AssetsPage({ viewModel, navigate }: AssetsPageProps) {
  const tabsId = "assets-tabs";
  const activeTabIndex = Math.max(0, viewModel.tabs.indexOf(viewModel.activeTab));

  return (
    <AppShell activeNav="assets" navigate={navigate} title={viewModel.title}>
      <div className="page-stack page-assets">
        <PageHeading action={<Button onClick={() => undefined} variant="secondary"><Icon name="upload" size={17} />{viewModel.uploadLabel}</Button>} description="集中管理拆解模板与创作素材" title={viewModel.title} />
        <Tabs active={viewModel.activeTab} id={tabsId} panelId={tabPanelId(tabsId)} tabs={viewModel.tabs} />
        <TabPanel className="page-stack" id={tabPanelId(tabsId)} labelledBy={tabId(tabsId, activeTabIndex)}>
          <div className="search-field"><Icon name="search" size={19} /><input aria-label="搜索素材" placeholder={viewModel.searchPlaceholder} type="search" /><button aria-label="筛选" type="button"><Icon name="tune" size={18} /></button></div>
          <div className="chip-row chip-row--scroll">{viewModel.filters.map((filter, index) => <Chip key={filter} selected={index === 0}>{filter}</Chip>)}</div>

          <section className="page-section">
            <SectionHeading action={<button className="text-action" type="button">查看全部</button>} title="推荐模板" />
            <div className="asset-template-grid">{viewModel.templates.map((template) => <GlassCard className="asset-template" key={template.id}><MediaFrame media={template.media}><span className={`asset-template__badge asset-template__badge--${template.badgeTone}`}>{template.badge}</span></MediaFrame><strong>{template.title}</strong><div className="chip-row">{template.tags.map((tag) => <span className="tag-text" key={tag}>{tag}</span>)}</div></GlassCard>)}</div>
          </section>

          <section className="page-section asset-library">
            <SectionHeading action={<span className="asset-count">{viewModel.assetCount}</span>} title={viewModel.assetTitle} />
            <div className="asset-library__layout">
              <aside className="folder-list">{viewModel.folders.map((folder, index) => <button className={index === 0 ? "is-active" : ""} key={folder} type="button"><Icon name={index === 0 ? "folder_open" : "folder"} size={17} />{folder}<span>{index === 0 ? viewModel.assetCount : index + 2}</span></button>)}</aside>
              <div className="asset-list">{viewModel.assets.map((asset) => <button className="asset-row" key={asset.id} onClick={() => navigate("/create")} type="button"><MediaFrame className="asset-row__media" media={asset.media} /><span className="asset-row__body"><strong>{asset.title}</strong><StatusBadge compact label={asset.statusLabel} status={asset.kind === "failed" ? "failed" : asset.kind === "uploading" ? "processing" : "completed"} /></span><Icon name="chevron_right" size={17} /></button>)}</div>
            </div>
          </section>

          <GlassCard className="empty-hint" tone="soft"><Icon name="folder_open" size={23} /><div><strong>{viewModel.emptyTitle}</strong><p>{viewModel.emptyDescription}</p></div><Button onClick={() => undefined} variant="ghost">{viewModel.emptyAction}</Button></GlassCard>
        </TabPanel>
      </div>
    </AppShell>
  );
}
