import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiMessage, AiRunRecord, DiagnosisReportV1, DiagnosisRepository, DiagnosisSession, ObservationMode } from "@hongtai/ai";

function sanitize(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
    .replace(/data:(image|audio)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "data:$1/[REDACTED];base64,[REDACTED]")
    .replace(/("?(?:api[_-]?key|authorization|cookie|token)"?\s*[:=]\s*")([^"]+)(")/gi, "$1[REDACTED]$3");
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw error;
  }
}

export class FileDiagnosisRepository implements DiagnosisRepository {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async createSession(mode: ObservationMode, image: { readonly mimeType: string; readonly data: Uint8Array }): Promise<DiagnosisSession> {
    const id = crypto.randomUUID();
    const root = this.#sessionRoot(id);
    await mkdir(join(root, "source"), { recursive: true });
    await mkdir(join(root, "runs"), { recursive: true });
    const imagePath = join("source", "normalized-image.jpg");
    const session: DiagnosisSession = { id, reportId: crypto.randomUUID(), mode, createdAt: new Date().toISOString(), imagePath };
    await writeFile(join(root, imagePath), image.data);
    await this.#writeJson(join(root, "session.json"), session);
    await writeFile(join(root, "messages.jsonl"), "", "utf8");
    await writeFile(join(root, "task.log"), "", "utf8");
    return session;
  }

  getSession(sessionId: string): Promise<DiagnosisSession | undefined> {
    return readJson(join(this.#sessionRoot(sessionId), "session.json"));
  }

  async saveReport(sessionId: string, report: DiagnosisReportV1): Promise<void> {
    await this.#writeJson(join(this.#sessionRoot(sessionId), "report.json"), report);
  }

  getReport(sessionId: string): Promise<DiagnosisReportV1 | undefined> {
    return readJson(join(this.#sessionRoot(sessionId), "report.json"));
  }

  async listMessages(sessionId: string): Promise<readonly AiMessage[]> {
    try {
      const text = await readFile(join(this.#sessionRoot(sessionId), "messages.jsonl"), "utf8");
      return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as AiMessage);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return [];
      throw error;
    }
  }

  async appendMessages(sessionId: string, messages: readonly AiMessage[]): Promise<void> {
    if (messages.length === 0) return;
    await appendFile(join(this.#sessionRoot(sessionId), "messages.jsonl"), `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`, "utf8");
  }

  async getContextSummary(sessionId: string): Promise<string> {
    const value = await readJson<{ summary?: unknown }>(join(this.#sessionRoot(sessionId), "context-summary.json"));
    return typeof value?.summary === "string" ? value.summary : "";
  }

  async saveContextSummary(sessionId: string, summary: string): Promise<void> {
    await this.#writeJson(join(this.#sessionRoot(sessionId), "context-summary.json"), { summary, updatedAt: new Date().toISOString() });
  }

  async saveRun(sessionId: string, run: AiRunRecord): Promise<void> {
    const root = join(this.#sessionRoot(sessionId), "runs", run.id);
    await mkdir(root, { recursive: true });
    const rawResponse = sanitize(run.rawResponse);
    const reasoning = sanitize(run.reasoning);
    await writeFile(join(root, "raw-response.json"), `${JSON.stringify({ content: rawResponse }, null, 2)}\n`, "utf8");
    const reasoningLines = reasoning.split(/\r?\n/).filter(Boolean)
      .map((content) => JSON.stringify({ type: "reasoning", content })).join("\n");
    await writeFile(join(root, "reasoning.jsonl"), reasoningLines ? `${reasoningLines}\n` : "", "utf8");
    const metadata = {
      id: run.id,
      kind: run.kind,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      errorCode: run.errorCode,
    };
    await this.#writeJson(join(root, "run.json"), { ...metadata, rawResponsePath: "raw-response.json", reasoningPath: "reasoning.jsonl" });
    await appendFile(join(this.#sessionRoot(sessionId), "task.log"), `${JSON.stringify({ runId: run.id, kind: run.kind, status: run.status, completedAt: run.completedAt, errorCode: run.errorCode })}\n`, "utf8");
  }

  #sessionRoot(sessionId: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) throw new Error("会话ID格式无效");
    return join(this.#root, sessionId);
  }

  async #writeJson(path: string, value: unknown): Promise<void> {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}
