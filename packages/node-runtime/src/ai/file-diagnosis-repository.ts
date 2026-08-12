import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiMessage, AiRunRecord, DiagnosisImageInput, DiagnosisReportV1, DiagnosisRepository, DiagnosisSession, ObservationMode } from "@hongtai/ai";
import { TaskError } from "@hongtai/core";

const SOURCE_IMAGE_PATH = join("source", "normalized-image.jpg");

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw error;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Old Node sessions stored `imagePath`; retain their CLI readability while
 * deliberately projecting only MIME metadata to the shared AI contract.
 */
function sessionProjection(value: unknown): DiagnosisSession | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id ||
      typeof value.reportId !== "string" || !value.reportId ||
      (value.mode !== "tongue" && value.mode !== "face") ||
      typeof value.createdAt !== "string" || !value.createdAt) {
    return undefined;
  }
  const image = isRecord(value.image) && typeof value.image.mimeType === "string" && value.image.mimeType
    ? { mimeType: value.image.mimeType }
    : typeof value.imagePath === "string" && value.imagePath
      ? { mimeType: "image/jpeg" }
      : undefined;
  if (!image) return undefined;
  return {
    id: value.id,
    reportId: value.reportId,
    mode: value.mode,
    createdAt: value.createdAt,
    image,
  };
}

export class FileDiagnosisRepository implements DiagnosisRepository {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async createSession(mode: ObservationMode, image: DiagnosisImageInput): Promise<DiagnosisSession> {
    if (!image.data) {
      throw new TaskError({ code: "IMAGE_INVALID", message: "Node 本地仓储无法读取原生图片 URI", action: "edit_input" });
    }
    const id = crypto.randomUUID();
    const root = this.#sessionRoot(id);
    await mkdir(join(root, "source"), { recursive: true });
    await mkdir(join(root, "runs"), { recursive: true });
    const session: DiagnosisSession = {
      id,
      reportId: crypto.randomUUID(),
      mode,
      createdAt: new Date().toISOString(),
      image: { mimeType: image.mimeType },
    };
    await writeFile(join(root, SOURCE_IMAGE_PATH), image.data);
    await this.#writeJson(join(root, "session.json"), session);
    await writeFile(join(root, "messages.jsonl"), "", "utf8");
    await writeFile(join(root, "task.log"), "", "utf8");
    return session;
  }

  async getSession(sessionId: string): Promise<DiagnosisSession | undefined> {
    return sessionProjection(await readJson<unknown>(join(this.#sessionRoot(sessionId), "session.json")));
  }

  async loadSessionImage(sessionId: string): Promise<DiagnosisImageInput | undefined> {
    const session = await this.getSession(sessionId);
    if (!session) return undefined;
    try {
      return { mimeType: session.image.mimeType, data: await readFile(join(this.#sessionRoot(sessionId), SOURCE_IMAGE_PATH)) };
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return undefined;
      throw error;
    }
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
    // Keep the legacy artifact paths readable, but never persist provider raw
    // output or reasoning. Live thinking is an in-memory presentation stream.
    await writeFile(join(root, "raw-response.json"), `${JSON.stringify({ content: "" }, null, 2)}\n`, "utf8");
    await writeFile(join(root, "reasoning.jsonl"), "", "utf8");
    const metadata = {
      id: run.id,
      kind: run.kind,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      errorCode: run.errorCode,
      promptVersions: run.promptVersions,
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
