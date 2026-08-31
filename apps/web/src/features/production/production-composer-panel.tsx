import type { ProductionAsset, ProductionMode, ProductionTextPreset } from "@hongtai/core";

import { AgentSetupForm, ReplicaSetupForm, type AnalysisSource } from "./production-setup-forms";

/** composer 只有两种做法：智能成片与爆款复刻。没有独立 pick 屏，默认直接进 agent 表单。 */
export type ComposerFlow = "agent" | "replica";

const FLOW_TAB_LABELS: Readonly<Record<ComposerFlow, string>> = { agent: "智能成片", replica: "爆款复刻" };

/**
 * 表单顶部的做法分段切换：沿用共享 tabs--segmented 的视觉语言（灰底轨道 + 卡片态选中），
 * 但用自己的类名——共享 .tabs 只允许出现在 components 层，页面层重写会在 Android WebView
 * 上压掉分段标签（见 tests/web-visual-foundation.test.ts 的分层护栏）。
 */
function ComposerFlowSwitch({ flow, onSelectEntry }: {
  readonly flow: ComposerFlow;
  readonly onSelectEntry: (flow: ComposerFlow) => void;
}) {
  return (
    <div aria-label="制作方式" className="production-flow-switch" role="group">
      {(Object.keys(FLOW_TAB_LABELS) as readonly ComposerFlow[]).map((item) => (
        <button
          aria-pressed={flow === item}
          className={flow === item ? "is-active" : ""}
          key={item}
          onClick={() => onSelectEntry(item)}
          type="button"
        >
          {FLOW_TAB_LABELS[item]}
        </button>
      ))}
    </div>
  );
}

export interface ProductionComposerPanelProps {
  readonly flow: ComposerFlow;
  readonly sources: readonly AnalysisSource[];
  readonly sourceId: string;
  readonly brief: string;
  readonly mode: ProductionMode;
  readonly headlineText: string;
  readonly textPreset: ProductionTextPreset;
  readonly avatarAsset?: ProductionAsset;
  readonly avatarBusy?: boolean;
  readonly onSelectEntry: (flow: ComposerFlow) => void;
  readonly onSourceId: (id: string) => void;
  readonly onBrief: (value: string) => void;
  readonly onMode: (value: ProductionMode) => void;
  readonly onHeadlineText: (value: string) => void;
  readonly onTextPreset: (value: ProductionTextPreset) => void;
  readonly onGoAnalyze: () => void;
  readonly onPickAvatar: () => void;
  readonly onRemoveAvatar: () => void;
}

export function ProductionComposerPanel({
  flow,
  sources,
  sourceId,
  brief,
  mode,
  headlineText,
  textPreset,
  avatarAsset,
  avatarBusy,
  onSelectEntry,
  onSourceId,
  onBrief,
  onMode,
  onHeadlineText,
  onTextPreset,
  onGoAnalyze,
  onPickAvatar,
  onRemoveAvatar,
}: ProductionComposerPanelProps) {
  // 原入口卡的合规 caveat 已分别迁移进两个表单底部的提示行，切换做法不丢文案。
  if (flow === "agent") {
    return (
      <>
        <ComposerFlowSwitch flow={flow} onSelectEntry={onSelectEntry} />
        <AgentSetupForm
          avatarAsset={avatarAsset}
          avatarBusy={avatarBusy}
          brief={brief}
          headlineText={headlineText}
          mode={mode}
          onBrief={onBrief}
          onGoAnalyze={onGoAnalyze}
          onHeadlineText={onHeadlineText}
          onMode={onMode}
          onPickAvatar={onPickAvatar}
          onRemoveAvatar={onRemoveAvatar}
          onSourceId={onSourceId}
          onTextPreset={onTextPreset}
          sourceId={sourceId}
          sources={sources}
          textPreset={textPreset}
        />
      </>
    );
  }

  return (
    <>
      <ComposerFlowSwitch flow={flow} onSelectEntry={onSelectEntry} />
      <ReplicaSetupForm
        onGoAnalyze={onGoAnalyze}
        onSourceId={onSourceId}
        sourceId={sourceId}
        sources={sources}
      />
    </>
  );
}
