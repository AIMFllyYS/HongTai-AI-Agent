import type { FeatureCapability } from "@hongtai/core";

import type { CreateViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { FeatureUnavailablePanel } from "../components/FeatureUnavailablePanel";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { SectionHeading } from "../components/Headings";

const plannedSteps = [
  { icon: "content_paste", label: "内容草案", detail: "输入与脚本结构" },
  { icon: "video_library", label: "素材编排", detail: "媒体选择与镜头组织" },
  { icon: "movie_edit", label: "成片导出", detail: "本地渲染与保存" },
] as const;

type CreateShellViewModel = Pick<CreateViewModel, "title">;

export interface CreatePageProps {
  /** The fixture may still supply the shell title, never creation state. */
  readonly viewModel?: CreateShellViewModel;
  readonly navigate: (path: string) => void;
  readonly capability?: FeatureCapability;
}

export function CreatePage({ viewModel, navigate, capability = "planned" }: CreatePageProps) {
  return (
    <AppShell activeNav="create" leadingAction={<span className="page-header-icon"><Icon name="movie_edit" size={25} /></span>} navigate={navigate} title={viewModel?.title ?? "制作"}>
      <div className="page-stack page-create" data-feature-capability={capability}>
        <FeatureUnavailablePanel capability={capability} feature="create" />

        <GlassCard className="planned-workbench planned-workbench--create">
          <div className="planned-workbench__heading">
            <span className="planned-workbench__kicker"><Icon name="movie_edit" size={16} />制作工作台</span>
            <span className="planned-workbench__state">能力预留</span>
          </div>
          <label className="field-label" htmlFor="create-prompt">制作需求</label>
          <textarea disabled id="create-prompt" placeholder="制作能力接入后，可在这里描述视频需求" rows={4} />
          <div className="planned-workbench__footer">
            <span><Icon name="info" size={16} />素材、模板与成片生成将在接入后启用</span>
            <Button disabled variant="secondary"><Icon name="rocket" size={17} />尚未接入</Button>
          </div>
        </GlassCard>

        <section className="page-section">
          <SectionHeading title="准备中的工作流" />
          <ol className="planned-flow">
            {plannedSteps.map((step) => (
              <li key={step.label}>
                <span className="planned-flow__icon"><Icon name={step.icon} size={19} /></span>
                <span><strong>{step.label}</strong><small>{step.detail}</small></span>
                <em>预留</em>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </AppShell>
  );
}
