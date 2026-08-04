import type { PlatformAdapter } from "@hongtai/core";

export class PlatformRegistry {
  readonly #adapters: readonly PlatformAdapter[];

  constructor(adapters: readonly PlatformAdapter[]) {
    this.#adapters = adapters;
  }

  get size(): number {
    return this.#adapters.length;
  }

  find(url: string): PlatformAdapter | undefined {
    return this.#adapters.find((adapter) => adapter.matches(url));
  }
}

// 平台实现将在后续逐项评审后注册，骨架阶段保持为空。
export const platformRegistry = new PlatformRegistry([]);

