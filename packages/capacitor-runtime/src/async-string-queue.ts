export class AsyncStringQueue {
  readonly #values: string[] = [];
  readonly #waiters: Array<{
    readonly resolve: (value: IteratorResult<string>) => void;
    readonly reject: (reason: unknown) => void;
  }> = [];
  #closed = false;
  #failure: unknown;
  #bufferedCharacters = 0;

  push(value: string): void {
    if (this.#closed || this.#failure !== undefined) return;
    if (value.length > MAX_BUFFERED_CHARACTERS || this.#bufferedCharacters + value.length > MAX_BUFFERED_CHARACTERS) {
      throw new Error("本地 AI 流响应超过安全大小限制");
    }
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
      return;
    }
    this.#values.push(value);
    this.#bufferedCharacters += value.length;
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
    if (nextValue !== undefined) {
      this.#bufferedCharacters -= nextValue.length;
      return Promise.resolve({ value: nextValue, done: false });
    }
    if (this.#failure !== undefined) return Promise.reject(this.#failure);
    if (this.#closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise<IteratorResult<string>>((resolve, reject) => this.#waiters.push({ resolve, reject }));
  }
}

export const MAX_BUFFERED_CHARACTERS = 2 * 1024 * 1024;
