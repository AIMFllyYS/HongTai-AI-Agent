import type { ProductionMode, ProductionTextPreset } from "@hongtai/core";

import { ProductionModeEntry, type ProductionEntryKind } from "../../components/ProductionModeEntry";
import { AgentSetupForm, ReplicaSetupForm, type AnalysisSource } from "./production-setup-forms";

export type ComposerFlow = "pick" | ProductionEntryKind;

export interface ProductionComposerPanelProps {
  readonly flow: ComposerFlow;
  readonly sources: readonly AnalysisSource[];
  readonly sourceId: string;
  readonly brief: string;
  readonly mode: ProductionMode;
  readonly headlineText: string;
  readonly textPreset: ProductionTextPreset;
  readonly onSelectEntry: (flow: ComposerFlow) => void;
  readonly onSourceId: (id: string) => void;
  readonly onBrief: (value: string) => void;
  readonly onMode: (value: ProductionMode) => void;
  readonly onHeadlineText: (value: string) => void;
  readonly onTextPreset: (value: ProductionTextPreset) => void;
  readonly onGoAnalyze: () => void;
}

export function ProductionComposerPanel({
  flow,
  sources,
  sourceId,
  brief,
  mode,
  headlineText,
  textPreset,
  onSelectEntry,
  onSourceId,
  onBrief,
  onMode,
  onHeadlineText,
  onTextPreset,
  onGoAnalyze,
}: ProductionComposerPanelProps) {
  if (flow === "pick") {
    return (
      <>
        <section className="production-hero">
          <h2>这次走哪条路？</h2>
          <p>先选一种做法。两条路要准备的东西不一样。</p>
        </section>
        <ProductionModeEntry onSelect={onSelectEntry} />
      </>
    );
  }

  if (flow === "agent") {
    return (
      <AgentSetupForm
        brief={brief}
        headlineText={headlineText}
        mode={mode}
        onBrief={onBrief}
        onGoAnalyze={onGoAnalyze}
        onHeadlineText={onHeadlineText}
        onMode={onMode}
        onSourceId={onSourceId}
        onTextPreset={onTextPreset}
        sourceId={sourceId}
        sources={sources}
        textPreset={textPreset}
      />
    );
  }

  return (
    <ReplicaSetupForm
      onGoAnalyze={onGoAnalyze}
      onSourceId={onSourceId}
      sourceId={sourceId}
      sources={sources}
    />
  );
}
