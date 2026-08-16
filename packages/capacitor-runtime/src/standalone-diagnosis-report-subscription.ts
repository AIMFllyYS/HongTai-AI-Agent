import type {
  DiagnosisReportEventListener,
  DiagnosisReportStreamEvent,
  StructuredGenerationModuleId,
  StructuredGenerationProgressV1,
} from "@hongtai/core";

export class DiagnosisReportSubscriptions {
  readonly #listeners = new Map<string, Set<DiagnosisReportEventListener>>();
  readonly #snapshots = new Map<string, StructuredGenerationProgressV1>();

  subscribe(sessionId: string, listener: DiagnosisReportEventListener): () => void {
    this.add(sessionId, listener);
    const snapshot = this.#snapshots.get(sessionId);
    if (snapshot) void this.notifyListener(listener, { type: "progress", sessionId, progress: snapshot });
    return () => {
      const listeners = this.#listeners.get(sessionId);
      listeners?.delete(listener);
      if (listeners?.size === 0) this.#listeners.delete(sessionId);
    };
  }

  add(sessionId: string, listener: DiagnosisReportEventListener): void {
    const listeners = this.#listeners.get(sessionId) ?? new Set<DiagnosisReportEventListener>();
    listeners.add(listener);
    this.#listeners.set(sessionId, listeners);
  }

  attachRunListener(sessionId: string, onEvent: DiagnosisReportEventListener): DiagnosisReportEventListener {
    const listener: DiagnosisReportEventListener = (event) => onEvent(event);
    this.add(sessionId, listener);
    const snapshot = this.#snapshots.get(sessionId);
    if (snapshot) void this.notifyListener(listener, { type: "progress", sessionId, progress: snapshot });
    return listener;
  }

  remove(sessionId: string, listener: DiagnosisReportEventListener): void {
    const listeners = this.#listeners.get(sessionId);
    listeners?.delete(listener);
    if (listeners?.size === 0) this.#listeners.delete(sessionId);
  }

  setSnapshot(sessionId: string, progress: StructuredGenerationProgressV1): void {
    this.#snapshots.set(sessionId, progress);
  }

  snapshot(sessionId: string): StructuredGenerationProgressV1 | undefined {
    return this.#snapshots.get(sessionId);
  }

  clearSnapshot(sessionId: string): void {
    this.#snapshots.delete(sessionId);
  }

  notify(sessionId: string, event: DiagnosisReportStreamEvent): void {
    const listeners = this.#listeners.get(sessionId);
    if (!listeners) return;
    for (const listener of listeners) void this.notifyListener(listener, event);
  }

  async notifyListener(listener: DiagnosisReportEventListener, event: DiagnosisReportStreamEvent): Promise<void> {
    try {
      await listener(event);
    } catch {
      // Page lifecycle changes cannot affect a persisted formal report.
    }
  }

  emptyProgress(): StructuredGenerationProgressV1 {
    return {
      schemaVersion: "structured-generation-progress.v1",
      flow: "diagnosis-report",
      phase: "preparing",
      modules: (["visual-observations", "observation-summary", "wellness-recommendations", "safety-limitations", "follow-up-questions"] as const)
        .map((moduleId) => ({ moduleId, status: "pending" as const })),
    };
  }

  failedModuleId(progress: StructuredGenerationProgressV1): StructuredGenerationModuleId | undefined {
    return progress.modules.find((module) => module.status === "failed")?.moduleId;
  }
}
