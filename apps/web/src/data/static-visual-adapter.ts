import type { VisualDataAdapter } from "./visual-adapter";
import { analysisResult, galleryDetail, videoDetail } from "./fixtures/analysis";
import { assets, create, publish, settings } from "./fixtures/creation-library";
import { home, processing } from "./fixtures/home";
import { vitalityResult, vitalityScan } from "./fixtures/vitality";

export function createStaticVisualDataAdapter(): VisualDataAdapter {
  return {
    source: "design-fixture",
    getHome: () => home,
    getProcessing: () => processing,
    getAnalysisResult: () => analysisResult,
    getDetail: (variant) => (variant === "gallery" ? galleryDetail : videoDetail),
    getCreate: () => create,
    getAssets: () => assets,
    getSettings: () => settings,
    getPublish: () => publish,
    getVitalityScan: () => vitalityScan,
    getVitalityResult: () => vitalityResult,
  };
}
