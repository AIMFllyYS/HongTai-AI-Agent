import type { AppRuntime } from "@hongtai/core";

import type { CreateViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { MaterialLibraryHeaderAction } from "../components/MaterialLibraryHeaderAction";
import { FeatureUnavailablePanel } from "../components/FeatureUnavailablePanel";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { ProductionWorkbenchPage } from "../features/production/production-workbench-page";

export { productionRenderStageCopy } from "../features/production/production-workbench-model";

type CreateShellViewModel = Pick<CreateViewModel, "title">;

export interface CreatePageProps {
  readonly viewModel?: CreateShellViewModel;
  readonly navigate: (path: string) => void;
  readonly runtime?: AppRuntime;
  readonly searchEpoch?: number;
}

export function CreatePage({ viewModel, navigate, runtime, searchEpoch = 0 }: CreatePageProps) {
  if (!runtime) return <PlannedCreatePage navigate={navigate} title={viewModel?.title} />;
  return <ProductionWorkbenchPage navigate={navigate} runtime={runtime} searchEpoch={searchEpoch} />;
}

function PlannedCreatePage({ navigate, title = "制作" }: { readonly navigate: (path: string) => void; readonly title?: string }) {
  return (
    <AppShell activeNav="create" headerAction={<MaterialLibraryHeaderAction />} leadingAction={<span className="page-header-icon"><Icon name="movie_edit" size={25} /></span>} navigate={navigate} title={title}>
      <div className="page-stack page-create" data-feature-capability="planned">
        <FeatureUnavailablePanel feature="create" />
        <GlassCard className="planned-workbench">
          <strong>制作工作台</strong>
          <textarea disabled placeholder="本预览不执行真实制作" rows={4} />
          <Button disabled variant="secondary">尚未接入预览数据</Button>
        </GlassCard>
      </div>
    </AppShell>
  );
}
