import { TaskError } from "@hongtai/core";
import type {
  ErrorCode,
  JsonObject,
  StructuredGenerationFlow,
  StructuredGenerationModuleId,
  StructuredGenerationModuleStatus,
  StructuredGenerationProgressListener,
  StructuredGenerationProgressV1,
} from "@hongtai/core";
import { ReasoningProgress } from "./reasoning-progress";

export interface StructuredGenerationListenerIssue {
  readonly phase: StructuredGenerationProgressV1["phase"];
  readonly name: string;
  readonly code?: ErrorCode;
}

function jsonObject(value: object): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function projectListenerIssue(
  error: unknown,
  phase: StructuredGenerationProgressV1["phase"],
): StructuredGenerationListenerIssue {
  return {
    phase,
    name: error instanceof Error ? error.name : "UnknownError",
    ...(error instanceof TaskError ? { code: error.code } : {}),
  };
}

export class StructuredGenerationProgressTracker {
  readonly #flow: StructuredGenerationFlow;
  readonly #moduleIds: readonly StructuredGenerationModuleId[];
  readonly #listener: StructuredGenerationProgressListener | undefined;
  readonly #thinking = new ReasoningProgress();
  readonly #states = new Map<StructuredGenerationModuleId, {
    status: StructuredGenerationModuleStatus;
    result?: JsonObject;
  }>();
  readonly #listenerIssues: StructuredGenerationListenerIssue[] = [];
  #phase: StructuredGenerationProgressV1["phase"] = "preparing";

  get listenerIssues(): readonly StructuredGenerationListenerIssue[] {
    return this.#listenerIssues;
  }

  constructor(
    flow: StructuredGenerationFlow,
    moduleIds: readonly StructuredGenerationModuleId[],
    listener?: StructuredGenerationProgressListener,
  ) {
    this.#flow = flow;
    this.#moduleIds = moduleIds;
    this.#listener = listener;
    for (const moduleId of moduleIds) this.#states.set(moduleId, { status: "pending" });
  }

  preparing(): Promise<void> {
    this.#phase = "preparing";
    return this.#emit();
  }

  running(moduleId: StructuredGenerationModuleId): Promise<void> {
    this.#phase = "generating";
    this.#states.set(moduleId, { status: "running" });
    return this.#emit();
  }

  validating(moduleId: StructuredGenerationModuleId, repairing: boolean): Promise<void> {
    this.#phase = "validating";
    this.#states.set(moduleId, { status: repairing ? "repairing" : "running" });
    return this.#emit();
  }

  repairing(moduleId: StructuredGenerationModuleId): Promise<void> {
    this.#phase = "generating";
    this.#states.set(moduleId, { status: "repairing" });
    return this.#emit();
  }

  restartRepairing(moduleId: StructuredGenerationModuleId): Promise<void> {
    this.#phase = "generating";
    for (const id of this.#moduleIds) this.#states.set(id, { status: "pending" });
    this.#states.set(moduleId, { status: "repairing" });
    return this.#emit();
  }

  validatingDocument(): Promise<void> {
    this.#phase = "validating";
    return this.#emit();
  }

  thinkingDelta(delta: string): Promise<void> {
    return this.#thinking.append(delta) ? this.#emit() : Promise.resolve();
  }

  completeThinking(): Promise<void> {
    return this.#thinking.complete() ? this.#emit() : Promise.resolve();
  }

  succeeded(moduleId: StructuredGenerationModuleId, result: object): Promise<void> {
    this.#phase = "validating";
    this.#states.set(moduleId, { status: "succeeded", result: jsonObject(result) });
    return this.#emit();
  }

  failed(moduleId: StructuredGenerationModuleId): Promise<void> {
    this.#phase = "validating";
    this.#states.set(moduleId, { status: "failed" });
    return this.#emit();
  }

  saving(): Promise<void> {
    this.#phase = "saving";
    return this.#emit();
  }

  snapshot(): StructuredGenerationProgressV1 {
    return {
      schemaVersion: "structured-generation-progress.v1",
      flow: this.#flow,
      phase: this.#phase,
      thinking: this.#thinking.snapshot(),
      modules: this.#moduleIds.map((moduleId) => {
        const state = this.#states.get(moduleId) ?? { status: "pending" as const };
        return { moduleId, status: state.status, ...(state.result ? { result: state.result } : {}) };
      }),
    };
  }

  async #emit(): Promise<void> {
    if (!this.#listener) return;
    try {
      await this.#listener(this.snapshot());
    } catch (error) {
      this.#listenerIssues.push(projectListenerIssue(error, this.#phase));
    }
  }
}
