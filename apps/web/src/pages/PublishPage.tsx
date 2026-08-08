import type { FeatureCapability } from "@hongtai/core";

import type { PublishViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { FeatureUnavailablePanel } from "../components/FeatureUnavailablePanel";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { SectionHeading } from "../components/Headings";

const plannedPlatforms = [
  { id: "douyin", label: "抖音", icon: "video_file" },
  { id: "xiaohongshu", label: "小红书", icon: "bookmark" },
  { id: "bilibili", label: "哔哩哔哩", icon: "movie" },
  { id: "kuaishou", label: "快手", icon: "share" },
] as const;

type PublishShellViewModel = Pick<PublishViewModel, "title">;

export interface PublishPageProps {
  /** The fixture may still supply the shell title, never publish state. */
  readonly viewModel?: PublishShellViewModel;
  readonly navigate: (path: string) => void;
  readonly capability?: FeatureCapability;
}

export function PublishPage({ viewModel, navigate, capability = "planned" }: PublishPageProps) {
  return (
    <AppShell activeNav="create" navigate={navigate} title={viewModel?.title ?? "发布"}>
      <div className="page-stack page-publish" data-feature-capability={capability}>
        <FeatureUnavailablePanel capability={capability} feature="publish" />

        <GlassCard className="planned-publish-preview">
          <div aria-hidden="true" className="planned-publish-preview__canvas">
            <span className="planned-publish-preview__play"><Icon name="play" size={23} /></span>
            <span className="planned-publish-preview__frame" />
          </div>
          <div className="planned-publish-preview__footer">
            <span><Icon name="video_file" size={17} />成片预览将在制作能力接入后显示</span>
            <Button disabled icon={<Icon name="download" size={18} />} variant="quiet">尚未接入</Button>
          </div>
        </GlassCard>

        <section className="page-section">
          <SectionHeading title="发布平台" />
          <div className="platform-grid" aria-label="预留发布平台">
            {plannedPlatforms.map((platform) => (
              <button className="platform-card" disabled key={platform.id} type="button">
                <span className="platform-card__icon"><Icon name={platform.icon} size={22} /></span>
                <strong>{platform.label}</strong>
                <small>尚未接入</small>
              </button>
            ))}
          </div>
          <p className="field-hint field-hint--center"><Icon name="info" size={14} />目前无法选择平台、保存草稿或提交发布。</p>
        </section>

        <div className="button-stack">
          <Button disabled size="lg"><Icon name="publish" size={18} />尚未接入</Button>
          <Button disabled variant="quiet">保存草稿</Button>
        </div>
      </div>
    </AppShell>
  );
}
