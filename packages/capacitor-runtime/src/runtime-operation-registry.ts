import type { RuntimeUnfinishedWork, RuntimeWorkExecution, RuntimeWorkKind } from "@hongtai/core";

import type { TaskGuardPort } from "./task-guard-client.js";

export interface RuntimeOperationIdentity {
  readonly kind: RuntimeWorkKind;
  readonly id: string;
  readonly execution: RuntimeWorkExecution;
}

interface ActiveOperation {
  readonly work: RuntimeUnfinishedWork;
  count: number;
}

function operationKey(operation: RuntimeOperationIdentity): string {
  return `${operation.kind}\u0000${operation.execution}\u0000${operation.id}`;
}

/**
 * Process-local evidence of work that still depends on the current WebView.
 * Persisted business status remains owned by the standalone domain services.
 * Long-task kinds are wrapped in the TaskGuard (foreground service + wake lock)
 * so they survive screen-off and backgrounding; `transient-operation` never is.
 */
export class RuntimeOperationRegistry {
  readonly #active = new Map<string, ActiveOperation>();
  readonly #taskGuard?: TaskGuardPort;

  constructor(options?: { readonly taskGuard?: TaskGuardPort }) {
    this.#taskGuard = options?.taskGuard;
  }

  begin(operation: RuntimeOperationIdentity): () => void {
    const key = operationKey(operation);
    const existing = this.#active.get(key);
    if (existing) existing.count += 1;
    else {
      this.#active.set(key, {
        work: { ...operation, source: "memory" },
        count: 1,
      });
    }

    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      const active = this.#active.get(key);
      if (!active) return;
      active.count -= 1;
      if (active.count === 0) this.#active.delete(key);
    };
  }

  async track<T>(operation: RuntimeOperationIdentity, run: () => Promise<T>): Promise<T> {
    const finish = this.begin(operation);
    const guarded = this.#taskGuard && operation.kind !== "transient-operation"
      ? this.#taskGuard.withTaskGuard(operation.kind, run)
      : run();
    try {
      return await guarded;
    } finally {
      finish();
    }
  }

  list(): readonly RuntimeUnfinishedWork[] {
    return [...this.#active.values()].map(({ work }) => ({ ...work }));
  }
}
