export interface CountdownClock {
  readonly now: () => number;
  readonly schedule: (callback: () => void, delayMs: number) => unknown;
  readonly cancel: (handle: unknown) => void;
}

const browserClock: CountdownClock = {
  now: () => performance.now(),
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (handle) => window.clearTimeout(handle as number),
};

export class PausableCountdown {
  readonly #durationMs: number;
  readonly #onElapsed: () => void;
  readonly #clock: CountdownClock;
  #remainingMs: number;
  #startedAt: number | undefined;
  #handle: unknown;

  constructor(durationMs: number, onElapsed: () => void, clock: CountdownClock = browserClock) {
    this.#durationMs = durationMs;
    this.#remainingMs = durationMs;
    this.#onElapsed = onElapsed;
    this.#clock = clock;
  }

  get remainingMs(): number {
    if (this.#startedAt === undefined) return this.#remainingMs;
    return Math.max(0, this.#remainingMs - (this.#clock.now() - this.#startedAt));
  }

  start(): void {
    this.dispose();
    this.#remainingMs = this.#durationMs;
    this.#schedule();
  }

  pause(): void {
    if (this.#startedAt === undefined) return;
    this.#remainingMs = this.remainingMs;
    this.#clearHandle();
  }

  resume(): void {
    if (this.#startedAt !== undefined || this.#remainingMs <= 0) return;
    this.#schedule();
  }

  dispose(): void {
    this.#clearHandle();
  }

  #schedule(): void {
    this.#startedAt = this.#clock.now();
    this.#handle = this.#clock.schedule(() => {
      this.#handle = undefined;
      this.#startedAt = undefined;
      this.#remainingMs = 0;
      this.#onElapsed();
    }, this.#remainingMs);
  }

  #clearHandle(): void {
    if (this.#handle !== undefined) this.#clock.cancel(this.#handle);
    this.#handle = undefined;
    this.#startedAt = undefined;
  }
}
