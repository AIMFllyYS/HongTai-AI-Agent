import type { StructuredGenerationThinkingV1 } from "@hongtai/core";

export interface ReasoningProgressOptions {
  readonly minCharacters?: number;
  readonly minIntervalMs?: number;
  readonly now?: () => number;
}

/** Coalesces raw reasoning for a runtime snapshot without persisting it. */
export class ReasoningProgress {
  readonly #minCharacters: number;
  readonly #minIntervalMs: number;
  readonly #now: () => number;
  #status: StructuredGenerationThinkingV1["status"] = "waiting";
  #text = "";
  #hasEmitted = false;
  #lastEmittedLength = 0;
  #lastEmittedAt = 0;

  constructor(options: ReasoningProgressOptions = {}) {
    this.#minCharacters = options.minCharacters ?? 48;
    this.#minIntervalMs = options.minIntervalMs ?? 250;
    this.#now = options.now ?? Date.now;
  }

  append(delta: string): StructuredGenerationThinkingV1 | undefined {
    if (!delta) return undefined;
    this.#status = "streaming";
    this.#text += delta;
    const now = this.#now();
    const shouldEmit = !this.#hasEmitted ||
      this.#text.length - this.#lastEmittedLength >= this.#minCharacters ||
      now - this.#lastEmittedAt >= this.#minIntervalMs;
    if (!shouldEmit) return undefined;
    return this.#recordEmission(now);
  }

  complete(): StructuredGenerationThinkingV1 | undefined {
    if (this.#status === "completed") return undefined;
    this.#status = "completed";
    return this.#recordEmission(this.#now());
  }

  snapshot(): StructuredGenerationThinkingV1 {
    return { status: this.#status, text: this.#text };
  }

  #recordEmission(now: number): StructuredGenerationThinkingV1 {
    this.#hasEmitted = true;
    this.#lastEmittedLength = this.#text.length;
    this.#lastEmittedAt = now;
    return this.snapshot();
  }
}
