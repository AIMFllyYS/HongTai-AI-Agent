import type { FeatureCapability } from "@hongtai/core";

import type { AssetsViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { FeatureUnavailablePanel } from "../components/FeatureUnavailablePanel";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { SectionHeading } from "../components/Headings";

type AssetsShellViewModel = Pick<AssetsViewModel, "title">;

export interface AssetsPageProps {
  /** The fixture may still supply the shell title, never library contents. */
  readonly viewModel?: AssetsShellViewModel;
  readonly navigate: (path: string) => void;
  readonly capability?: FeatureCapability;
}

export function AssetsPage({ viewModel, navigate, capability = "planned" }: AssetsPageProps) {
  return (
    <AppShell
      activeNav="assets"
      headerAction={<Button className="header-action__button" disabled variant="secondary"><Icon name="upload" size={17} />尚未接入</Button>}
      leadingAction={<span className="page-header-icon"><Icon name="folder_special" size={25} /></span>}
      navigate={navigate}
      title={viewModel?.title ?? "素材"}
    >
      <div className="page-stack page-assets" data-feature-capability={capability}>
        <FeatureUnavailablePanel capability={capability} feature="assets" />

        <GlassCard className="planned-library">
          <div className="planned-library__heading">
            <div>
              <span className="planned-library__kicker"><Icon name="folder_open" size={16} />本地素材库</span>
              <strong>素材将在接入后显示</strong>
            </div>
            <span className="planned-library__state">尚未接入</span>
          </div>

          <div className="planned-library__toolbar">
            <label className="search-field">
              <Icon name="search" size={19} />
              <input aria-label="搜索素材" disabled placeholder="素材库接入后可搜索" type="search" />
            </label>
            <Button disabled icon={<Icon name="tune" size={17} />} variant="quiet">筛选</Button>
          </div>

          <div aria-hidden="true" className="planned-library__canvas">
            <span className="planned-library__folder"><Icon name="folder" size={30} /></span>
            <span className="planned-library__line planned-library__line--wide" />
            <span className="planned-library__line" />
            <span className="planned-library__line planned-library__line--short" />
          </div>
        </GlassCard>

        <section className="page-section">
          <SectionHeading title="后续将支持" />
          <div className="planned-library__capabilities">
            <span><Icon name="upload_file" size={18} />导入本地媒体</span>
            <span><Icon name="folder_special" size={18} />分类整理素材</span>
            <span><Icon name="video_library" size={18} />在制作中引用</span>
          </div>
          <Button disabled size="lg"><Icon name="upload" size={18} />尚未接入</Button>
        </section>
      </div>
    </AppShell>
  );
}
