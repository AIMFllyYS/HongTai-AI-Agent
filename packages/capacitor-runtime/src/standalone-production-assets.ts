import { MAX_SHOTS_PER_PRODUCTION, TaskError } from "@hongtai/core";

import type { NativeProductionAsset } from "./standalone-bridge.js";
import { productionArtifactError } from "./standalone-production-native-errors.js";
import {
  defaultAssetRole,
  isRequirementOrder,
  nativeAsset,
  type PersistedAsset,
  type PersistedProject,
} from "./standalone-production-record.js";

export function importSelectionOf(project: Pick<PersistedProject, "mode">): "avatar" | "visual" {
  return project.mode === "avatar" ? "avatar" : "visual";
}

export function remainingAssetSlots(project: Pick<PersistedProject, "assets">): number {
  return MAX_SHOTS_PER_PRODUCTION - project.assets.length;
}

export function dropPendingRequirement(project: PersistedProject): PersistedProject {
  if (project.pendingRequirementOrder === undefined) return project;
  const { pendingRequirementOrder: _pending, ...base } = project;
  void _pending;
  return base;
}

export function assertImportAllowed(project: PersistedProject, requirementOrder?: number): void {
  if (remainingAssetSlots(project) <= 0) throw productionArtifactError("每个制作项目最多使用12个素材", "select_media");
  const selection = importSelectionOf(project);
  if (selection === "avatar" && project.assets.some((asset) => (asset.role ?? defaultAssetRole(asset)) === "avatar")) {
    throw productionArtifactError("数字人口播模式只能上传一个数字人口播视频", "select_media");
  }
  if (requirementOrder === undefined) return;
  if (!isRequirementOrder(requirementOrder)) throw productionArtifactError("素材清单项编号无效", "select_media");
  if (project.assets.some((asset) => asset.requirementOrder === requirementOrder)) {
    throw productionArtifactError(`第 ${requirementOrder} 项已经有素材了，先移除再换一个`, "select_media");
  }
}

export type BindImportedAssetsResult =
  | { readonly status: "bound"; readonly project: PersistedProject }
  | { readonly status: "rejected"; readonly error: TaskError; readonly clearPending: boolean };

/**
 * Merges picker results into the project record. Clearing `pendingRequirementOrder` is the
 * caller's job: empty / wrong-avatar rejects must drop the marker, but an over-limit merge
 * must not, matching the previous inline control flow.
 */
export function bindImportedAssets(
  project: PersistedProject,
  assets: readonly NativeProductionAsset[],
): BindImportedAssetsResult {
  const selection = importSelectionOf(project);
  const imported = assets.map(nativeAsset).filter((asset): asset is NativeProductionAsset => Boolean(asset));
  if (imported.length === 0) {
    return { status: "rejected", clearPending: true, error: productionArtifactError("没有导入可用的图片、视频或音频", "select_media") };
  }
  if (selection === "avatar" && (imported.length !== 1 || imported[0]?.role !== "avatar" || imported[0].kind !== "video")) {
    return { status: "rejected", clearPending: true, error: productionArtifactError("请选择一个包含口播原声的 MP4 数字人视频", "select_media") };
  }
  const order = project.pendingRequirementOrder;
  const bound: readonly PersistedAsset[] = order !== undefined && imported.length === 1
    ? [{ ...imported[0]!, requirementOrder: order }]
    : imported;
  const combined = new Map([...project.assets, ...bound].map((asset) => [asset.id, asset]));
  if (combined.size > MAX_SHOTS_PER_PRODUCTION) {
    return { status: "rejected", clearPending: false, error: productionArtifactError("每个制作项目最多使用12个素材", "select_media") };
  }
  const { plan: _plan, output: _output, issue: _issue, pendingRequirementOrder: _pending, ...base } = project;
  void _plan; void _output; void _issue; void _pending;
  return { status: "bound", project: { ...base, assets: [...combined.values()], status: "draft" } };
}
