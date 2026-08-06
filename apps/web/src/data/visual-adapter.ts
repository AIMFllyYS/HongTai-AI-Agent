import type {
  AnalysisResultViewModel,
  AssetsViewModel,
  CreateViewModel,
  DetailViewModel,
  HomeViewModel,
  ProcessingViewModel,
  PublishViewModel,
  SettingsViewModel,
  VitalityResultViewModel,
  VitalityScanViewModel,
  VisualSource,
} from "./visual-types";

export interface VisualDataAdapter {
  readonly source: VisualSource;
  getHome(): HomeViewModel;
  getProcessing(): ProcessingViewModel;
  getAnalysisResult(): AnalysisResultViewModel;
  getDetail(variant: "video" | "gallery"): DetailViewModel;
  getCreate(): CreateViewModel;
  getAssets(): AssetsViewModel;
  getSettings(): SettingsViewModel;
  getPublish(): PublishViewModel;
  getVitalityScan(): VitalityScanViewModel;
  getVitalityResult(): VitalityResultViewModel;
}
