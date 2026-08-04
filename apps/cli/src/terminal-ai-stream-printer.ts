import type { AiStreamEvent } from "@hongtai/ai";

type StreamChannel = "reasoning" | "content";

export class TerminalAiStreamPrinter {
  readonly #write: (value: string) => void;
  readonly #sanitize: (value: string) => string;
  #activeChannel: StreamChannel | undefined;

  constructor(write: (value: string) => void, sanitize: (value: string) => string = (value) => value) {
    this.#write = write;
    this.#sanitize = sanitize;
  }

  handle(event: AiStreamEvent): void {
    if (event.type === "reasoning_delta" || event.type === "content_delta") {
      const channel = event.type === "reasoning_delta" ? "reasoning" : "content";
      if (this.#activeChannel !== channel) {
        this.#endLine();
        this.#write(channel === "reasoning" ? "[思考] " : "[输出] ");
        this.#activeChannel = channel;
      }
      this.#write(this.#sanitize(event.delta));
      return;
    }
    if (event.type === "usage") {
      this.#endLine();
      this.#write(`[用量] 输入=${event.promptTokens ?? "未知"}，输出=${event.completionTokens ?? "未知"}\n`);
      return;
    }
    this.#endLine();
  }

  #endLine(): void {
    if (this.#activeChannel) this.#write("\n");
    this.#activeChannel = undefined;
  }
}
