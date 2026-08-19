import type { ContentAnalysisResultV1 } from "../schemas/content-analysis";
import type { ContentEvidenceUnit } from "./content-analysis";
import type { AiProvider } from "./provider";

export interface ReplicaBlueprintInput {
  /** The finished breakdown. The blueprint is derived from it and never replaces it. */
  readonly analysis: ContentAnalysisResultV1;
  /**
   * The same evidence the breakdown was built from. The breakdown only carries evidence *ids*, so
   * without the units a blueprint could cite anything and describe shots nobody can check.
   */
  readonly evidenceUnits: readonly ContentEvidenceUnit[];
  /** Reference copy, used only to reject a script draft that repeats the original author. */
  readonly originalSourceText?: string;
}

export interface ReplicaBlueprintFlowDependencies {
  readonly provider: AiProvider;
}
