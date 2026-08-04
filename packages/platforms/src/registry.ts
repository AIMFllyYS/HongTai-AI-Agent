import type { PlatformAdapter } from "@hongtai/core";

export class PlatformRegistry {
  readonly #adapters: readonly PlatformAdapter[];

  constructor(adapters: readonly PlatformAdapter[]) {
    this.#adapters = adapters;
  }

  get size(): number {
    return this.#adapters.length;
  }

  get all(): readonly PlatformAdapter[] {
    return this.#adapters;
  }

  find(url: string): PlatformAdapter | undefined {
    return this.#adapters.find((adapter) => adapter.matches(url));
  }
}

