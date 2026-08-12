import type { RuntimeRecoveryProjection, RuntimeUnfinishedWork } from "@hongtai/core";

import type { RuntimeOperationRegistry } from "./runtime-operation-registry.js";

export interface StandaloneRecoveryPort {
  inspectUnfinishedWork(): Promise<readonly RuntimeUnfinishedWork[]>;
  recoverInterruptedWork(): Promise<readonly RuntimeUnfinishedWork[]>;
}

export interface StandaloneRuntimeRecoveryOptions {
  readonly operations: RuntimeOperationRegistry;
  readonly sources: readonly StandaloneRecoveryPort[];
}

function workKey(work: RuntimeUnfinishedWork): string {
  return `${work.kind}\u0000${work.id}\u0000${work.source}\u0000${work.execution}`;
}

function normalized(groups: readonly (readonly RuntimeUnfinishedWork[])[]): readonly RuntimeUnfinishedWork[] {
  const unique = new Map<string, RuntimeUnfinishedWork>();
  for (const group of groups) {
    for (const work of group) unique.set(workKey(work), { ...work });
  }
  return [...unique.values()].sort((left, right) => workKey(left).localeCompare(workKey(right), "en"));
}

function errors(results: readonly PromiseSettledResult<unknown>[]): readonly unknown[] {
  return results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
}

function values(
  results: readonly PromiseSettledResult<readonly RuntimeUnfinishedWork[]>[],
): readonly (readonly RuntimeUnfinishedWork[])[] {
  return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

/**
 * Aggregates owner-provided recovery without reading or rewriting domain files.
 * Every source is attempted before a partial failure is surfaced.
 */
export class StandaloneRuntimeRecovery {
  readonly #operations: RuntimeOperationRegistry;
  readonly #sources: readonly StandaloneRecoveryPort[];

  constructor(options: StandaloneRuntimeRecoveryOptions) {
    this.#operations = options.operations;
    this.#sources = [...options.sources];
  }

  async inspectUnfinishedWork(): Promise<readonly RuntimeUnfinishedWork[]> {
    const inspections = await Promise.allSettled(this.#sources.map((source) => source.inspectUnfinishedWork()));
    const failures = errors(inspections);
    if (failures.length > 0) throw new AggregateError(failures, "无法完整检查本地未完成流程");
    return normalized([this.#operations.list(), ...values(inspections)]);
  }

  async recoverInterruptedWork(): Promise<RuntimeRecoveryProjection> {
    const inspections = await Promise.allSettled(this.#sources.map((source) => source.inspectUnfinishedWork()));
    const unfinished = normalized([this.#operations.list(), ...values(inspections)]);
    const recoveries = await Promise.allSettled(this.#sources.map((source) => source.recoverInterruptedWork()));
    const failures = [...errors(inspections), ...errors(recoveries)];
    if (failures.length > 0) throw new AggregateError(failures, "本地流程中断恢复未能全部完成");
    return { unfinished, recovered: normalized(values(recoveries)) };
  }
}
