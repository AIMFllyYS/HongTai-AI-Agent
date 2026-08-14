import type { FeatureCapability } from "@hongtai/core";

import { GlassCard } from "./GlassCard";
import { Icon } from "./Icon";

type TaskFeature = "ingest" | "contentAnalysis";

const copy: Readonly<Record<TaskFeature, { readonly title: string; readonly description: string }>> = {
  ingest: {
    title: "URL 采集尚未接入",
    description: "当前 APK 运行时还没有可执行的本地下载、媒体和文稿任务，因此不会创建演示任务或展示模拟进度。",
  },
  contentAnalysis: {
    title: "内容拆解尚未接入",
    description: "当前版本暂时不能生成内容拆解和模板。",
  },
};

export interface TaskCapabilityNoticeProps {
  readonly feature: TaskFeature;
  readonly capability: FeatureCapability;
}

/** A truthful empty state for task capabilities that the current runtime has not delivered. */
export function TaskCapabilityNotice({ feature, capability }: TaskCapabilityNoticeProps) {
  if (capability === "available") return null;
  const item = copy[feature];
  return (
    <GlassCard className="task-capability-notice" data-feature={feature} data-feature-capability={capability} tone="soft">
      <span aria-hidden="true" className="task-capability-notice__icon"><Icon name="pending" size={22} /></span>
      <div>
        <span>尚未接入</span>
        <strong>{item.title}</strong>
        <p>{item.description}</p>
      </div>
    </GlassCard>
  );
}
