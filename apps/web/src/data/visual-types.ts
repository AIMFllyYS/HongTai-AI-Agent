import type { StageStatus, SupportedPlatform, TaskStage } from "@hongtai/core";

export type VisualSource = "design-fixture" | "repository";
export type VisualStatus = "completed" | "processing" | "pending" | "failed" | "neutral";

export interface VisualMedia {
  readonly src?: string;
  readonly alt: string;
  readonly aspectRatio?: string;
  readonly tone: "sage" | "forest" | "warm" | "teal" | "ink";
}

export interface RecentAnalysis {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly status: VisualStatus;
  readonly statusLabel: string;
  readonly platform: SupportedPlatform;
  readonly media?: VisualMedia;
}

export interface CapabilityTile {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  readonly tone: "mint" | "neutral";
}

export interface HomeViewModel {
  readonly source: VisualSource;
  readonly title: string;
  readonly subtitle: string;
  readonly inputTitle: string;
  readonly inputPlaceholder: string;
  readonly inputHint: string;
  readonly primaryActionLabel: string;
  readonly capabilities: readonly CapabilityTile[];
  readonly recentTitle: string;
  readonly recentToggleLabel: string;
  readonly recent: readonly RecentAnalysis[];
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly emptyActionLabel: string;
}

export interface ProcessingStepViewModel {
  readonly stage: TaskStage;
  readonly label: string;
  readonly status: StageStatus;
  readonly statusLabel: string;
  readonly detail?: string;
  readonly progress?: number;
}

export interface ProcessingViewModel {
  readonly source: VisualSource;
  readonly title: string;
  readonly input: string;
  readonly currentTitle: string;
  readonly currentDescription: string;
  readonly cancelLabel: string;
  readonly downloadProgress: number;
  readonly downloadSummary: string;
  readonly steps: readonly ProcessingStepViewModel[];
  readonly recent: readonly RecentAnalysis[];
}

export interface AnalysisTimelineItem {
  readonly id: string;
  readonly label: string;
  readonly timeRange: string;
  readonly tone: "primary" | "accent" | "neutral" | "error";
  readonly description: string;
  readonly tags?: readonly string[];
}

export interface AnalysisResultViewModel {
  readonly source: VisualSource;
  readonly title: string;
  readonly media: VisualMedia;
  readonly duration: string;
  readonly viewCount: string;
  readonly tabs: readonly string[];
  readonly activeTab: string;
  readonly intro: string;
  readonly timeline: readonly AnalysisTimelineItem[];
  readonly templateTitle: string;
  readonly templateDescription: string;
  readonly templateMeta: readonly { readonly label: string; readonly value: string }[];
  readonly templateAction: string;
  readonly saveAction: string;
  readonly retryAction: string;
}

export interface DetailMetric {
  readonly icon: string;
  readonly label: string;
  readonly value: string;
}

export interface DetailViewModel {
  readonly source: VisualSource;
  readonly variant: "video" | "gallery";
  readonly title: string;
  readonly contentTitle: string;
  readonly author: string;
  readonly duration: string;
  readonly platformLabel: string;
  readonly statusLabel: string;
  readonly media: VisualMedia;
  readonly metrics: readonly DetailMetric[];
  readonly gallery?: {
    readonly title: string;
    readonly countLabel: string;
    readonly sizeLabel: string;
    readonly durationLabel: string;
    readonly saveLabel: string;
    readonly media: VisualMedia;
  };
  readonly tabs: readonly string[];
  readonly activeTab: string;
  readonly transcript: readonly { readonly time: string; readonly text: string }[];
  readonly analysisIntro: string;
  readonly timeline: readonly AnalysisTimelineItem[];
  readonly tags: readonly string[];
}

export interface CreateTemplate {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly media: VisualMedia;
  readonly selected?: boolean;
}

export interface CreateViewModel {
  readonly source: VisualSource;
  readonly title: string;
  readonly promptLabel: string;
  readonly promptPlaceholder: string;
  readonly profileTitle: string;
  readonly profileTags: readonly string[];
  readonly templateTitle: string;
  readonly templateMoreLabel: string;
  readonly templates: readonly CreateTemplate[];
  readonly materialTitle: string;
  readonly materialFilters: readonly string[];
  readonly actionLabel: string;
  readonly generationTitle: string;
  readonly generationDescription: string;
  readonly generationEta: string;
}

export interface AssetTemplate {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly badge: string;
  readonly badgeTone: "dark" | "soft";
  readonly media: VisualMedia;
}

export interface AssetItem {
  readonly id: string;
  readonly title: string;
  readonly kind: "uploading" | "ready" | "failed";
  readonly statusLabel: string;
  readonly media: VisualMedia;
}

export interface AssetsViewModel {
  readonly source: VisualSource;
  readonly title: string;
  readonly uploadLabel: string;
  readonly tabs: readonly string[];
  readonly activeTab: string;
  readonly searchPlaceholder: string;
  readonly filters: readonly string[];
  readonly templates: readonly AssetTemplate[];
  readonly folderTitle: string;
  readonly folders: readonly string[];
  readonly assetTitle: string;
  readonly assetCount: string;
  readonly assets: readonly AssetItem[];
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly emptyAction: string;
}

export interface SettingsRow {
  readonly id: string;
  readonly icon: string;
  readonly label: string;
  readonly value?: string;
  readonly action: "disclosure" | "select" | "masked" | "static";
  readonly disabled?: boolean;
}

export interface SettingsViewModel {
  readonly source: VisualSource;
  readonly title: string;
  readonly profileName: string;
  readonly accountType: string;
  readonly plan: string;
  readonly avatar: VisualMedia;
  readonly aiConfigTitle: string;
  readonly voiceRow: SettingsRow;
  readonly modelTitle: string;
  readonly modelRows: readonly SettingsRow[];
  readonly generalTitle: string;
  readonly generalRows: readonly SettingsRow[];
  readonly logoutLabel: string;
  readonly copyright: string;
}

export interface PublishPlatform {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
}

export interface PublishViewModel {
  readonly source: VisualSource;
  readonly title: string;
  readonly media: VisualMedia;
  readonly platformsTitle: string;
  readonly platforms: readonly PublishPlatform[];
  readonly hint: string;
  readonly primaryAction: string;
  readonly secondaryActions: readonly string[];
}

export interface VitalityScanViewModel {
  readonly source: VisualSource;
  readonly brand: string;
  readonly title: string;
  readonly description: string;
  readonly scanLabel: string;
  readonly uploadLabel: string;
  readonly adviceTitle: string;
  readonly advice: readonly { readonly icon: string; readonly text: string }[];
  readonly historyTitle: string;
  readonly historyDescription: string;
}

export interface VitalityObservation {
  readonly label: string;
  readonly value: string;
}

export interface VitalityResultViewModel {
  readonly source: VisualSource;
  readonly title: string;
  readonly scoreTitle: string;
  readonly scoreDescription: string;
  readonly score: number;
  readonly scoreMax: number;
  readonly faceMedia: VisualMedia;
  readonly tongueMedia: VisualMedia;
  readonly faceTitle: string;
  readonly tongueTitle: string;
  readonly completedLabel: string;
  readonly faceObservations: readonly VitalityObservation[];
  readonly tongueObservations: readonly VitalityObservation[];
  readonly recommendationTitle: string;
  readonly recommendations: readonly { readonly icon: string; readonly text: string }[];
  readonly saveLabel: string;
  readonly consultLabel: string;
}
