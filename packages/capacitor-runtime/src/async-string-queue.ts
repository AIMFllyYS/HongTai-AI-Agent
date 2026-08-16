export class AsyncStringQueue {
  readonly #values: string[] = [];
  readonly #waiters: Array<{
    readonly resolve: (value: IteratorResult<string>) => void;
    readonly reject: (reason: unknown) => void;
  }> = [];
  #closed = false;
  #failure: unknown;

  push(value: string): void {
    if (this.#closed || this.#failure !== undefined) return;
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
      return;
    }
    this.#values.push(value);
  }

  close(): void {
    if (this.#closed || this.#failure !== undefined) return;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
  }

  fail(error: unknown): void {
    if (this.#closed || this.#failure !== undefined) return;
    this.#failure = error;
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }

  async *iterate(): AsyncIterable<string> {
    while (true) {
      const next = await this.#next();
      if (next.done) return;
      yield next.value;
    }
  }

  #next(): Promise<IteratorResult<string>> {
    const nextValue = this.#values.shift();
    if (nextValue !== undefined) return Promise.resolve({ value: nextValue, done: false });
    if (this.#failure !== undefined) return Promise.reject(this.#failure);
    if (this.#closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise<IteratorResult<string>>((resolve, reject) => this.#waiters.push({ resolve, reject }));
  }
}
