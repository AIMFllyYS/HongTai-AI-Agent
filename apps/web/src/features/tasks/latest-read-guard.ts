/** Instance-local generation token. `current()` does not bump; only `begin()` / `invalidate()` retire in-flight reads. */
export class LatestReadGuard {
  #generation = 0;

  current(): number {
    return this.#generation;
  }

  begin(): number {
    this.#generation += 1;
    return this.#generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.#generation;
  }

  invalidate(): void {
    this.#generation += 1;
  }
}

export function preferNewerByUpdatedAt<T extends { readonly updatedAt: string }>(
  current: T | undefined,
  incoming: T | undefined,
): T | undefined {
  if (!incoming) return current;
  if (!current) return incoming;
  return Date.parse(incoming.updatedAt) >= Date.parse(current.updatedAt) ? incoming : current;
}
