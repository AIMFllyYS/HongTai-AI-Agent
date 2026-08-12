import type { AppFeature, FeatureCapability } from "@hongtai/core";

import { GlassCard } from "./GlassCard";
import { Icon } from "./Icon";

type PlannedFeature = Extract<AppFeature, "create" | "publish">;

const defaultCopy: Readonly<Record<PlannedFeature, { readonly title: string; readonly description: string }>> = {
  create: {
    title: "智能制作正在准备中",
    description: "当前版本尚未接入脚本生成、素材编排和成片导出。",
  },
  publish: {
    title: "发布能力正在准备中",
    description: "当前版本尚未接入平台授权、草稿同步或正式发布。",
  },
};

export interface FeatureUnavailablePanelProps {
  readonly feature: PlannedFeature;
  /** Runtime capability can replace the default when a real feature is delivered. */
  readonly capability?: FeatureCapability;
  readonly title?: string;
  readonly description?: string;
  readonly className?: string;
}

/**
 * A safe, reusable boundary for feature shells that have visual designs but no
 * corresponding local application capability yet.
 */
export function FeatureUnavailablePanel({
  feature,
  capability = "planned",
  title,
  description,
  className = "",
}: FeatureUnavailablePanelProps) {
  if (capability === "available") return null;

  const copy = defaultCopy[feature];
  return (
    <GlassCard
      aria-live="polite"
      className={`feature-unavailable-panel ${className}`.trim()}
      data-feature={feature}
      data-feature-capability={capability}
      tone="soft"
    >
      <span aria-hidden="true" className="feature-unavailable-panel__icon"><Icon name="pending" size={22} /></span>
      <div className="feature-unavailable-panel__content">
        <span className="feature-unavailable-panel__status">尚未接入</span>
        <strong>{title ?? copy.title}</strong>
        <p>{description ?? copy.description}</p>
      </div>
    </GlassCard>
  );
}
