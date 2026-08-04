import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ContentAnalysisInput, ContentAnalysisResultV1, ContentAnalysisRunRecord, ContentAnalysisStore, ContentEvidenceUnit } from "@hongtai/ai";
import { TaskError, type ContentType, type SupportedPlatform } from "@hongtai/core";
import { sanitizeAiArtifactText } from "./sanitize-ai-artifact";

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    throw new TaskError({ code: "TASK_ARTIFACT_MISSING", message: `无法读取任务产物：${path}`, action: "view_partial_result", cause: error });
  }
}

function paragraphs(text: string): ContentEvidenceUnit[] {
  return text.split(/\r?\n\s*\r?\n/).map((item) => item.trim()).filter(Boolean)
    .map((item, index) => ({ id: `paragraph-${index + 1}`, text: item }));
}

export class FileContentAnalysisStore implements ContentAnalysisStore {
  readonly #workspace: string;

  constructor(workspace: string) {
    this.#workspace = workspace;
  }

  async loadInput(taskId: string): Promise<ContentAnalysisInput> {
    const root = this.#taskRoot(taskId);
    const task = await readJson(join(root, "task.json"));
    const metadata = await readJson(join(root, "metadata.json"));
    const platform = (task.platform ?? metadata.platform) as SupportedPlatform;
    const contentType = (task.contentType ?? metadata.contentType) as ContentType;
    if (!(["douyin", "xiaohongshu", "bilibili"] as const).includes(platform)) {
      throw new TaskError({ code: "TASK_ARTIFACT_MISSING", message: "任务缺少受支持的平台信息", action: "view_partial_result" });
    }
    if (contentType === "image_text") {
      const text = await this.#readText(join(root, "content", "content.txt"));
      return { taskId, platform, contentType, sourceKind: "image_text", title: this.#string(metadata.title), author: this.#string(metadata.author), evidenceUnits: paragraphs(text) };
    }
    if (contentType !== "video") {
      throw new TaskError({ code: "TASK_ARTIFACT_MISSING", message: "任务不是可拆解的视频或图文内容", action: "view_partial_result" });
    }
    const transcript = await this.#readText(join(root, "transcript", "transcript.txt"));
    const transcriptData: Record<string, unknown> = await readJson(join(root, "transcript", "transcript.json")).catch(() => ({}));
    const sourceKind = transcriptData.source === "description" ? "description" : "asr";
    const segments: unknown[] = Array.isArray(transcriptData.segments) ? transcriptData.segments : [];
    const evidenceUnits = segments.flatMap((item): ContentEvidenceUnit[] => {
      if (!item || typeof item !== "object") return [];
      const segment = item as Record<string, unknown>;
      if (typeof segment.index !== "number" || typeof segment.text !== "string" || !segment.text.trim()) return [];
      return [{
        id: `segment-${segment.index}`,
        text: segment.text.trim(),
        ...(typeof segment.startSeconds === "number" ? { startSeconds: segment.startSeconds } : {}),
        ...(typeof segment.endSeconds === "number" ? { endSeconds: segment.endSeconds } : {}),
      }];
    });
    return {
      taskId, platform, contentType, sourceKind,
      title: this.#string(metadata.title), author: this.#string(metadata.author),
      evidenceUnits: evidenceUnits.length > 0 ? evidenceUnits : paragraphs(transcript),
    };
  }

  async saveResult(taskId: string, result: ContentAnalysisResultV1, run: ContentAnalysisRunRecord): Promise<void> {
    const root = await this.#analysisRoot(taskId);
    await this.#writeJson(join(root, "content-analysis.json"), result);
    await this.#saveRun(root, run);
  }

  async saveFailedRun(taskId: string, run: ContentAnalysisRunRecord): Promise<void> {
    await this.#saveRun(await this.#analysisRoot(taskId), run);
  }

  async #saveRun(root: string, run: ContentAnalysisRunRecord): Promise<void> {
    await this.#writeJson(join(root, "raw-response.json"), { content: sanitizeAiArtifactText(run.rawResponse) });
    const reasoning = sanitizeAiArtifactText(run.reasoning).split(/\r?\n/).filter(Boolean)
      .map((content) => JSON.stringify({ type: "reasoning", content })).join("\n");
    await writeFile(join(root, "reasoning.jsonl"), reasoning ? `${reasoning}\n` : "", "utf8");
    await this.#writeJson(join(root, "run.json"), {
      id: run.id, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt,
      errorCode: run.errorCode, rawResponsePath: "raw-response.json", reasoningPath: "reasoning.jsonl",
    });
  }

  #taskRoot(taskId: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(taskId)) throw new TaskError({ code: "TASK_ARTIFACT_MISSING", message: "任务ID格式无效", action: "edit_input" });
    return join(this.#workspace, "tasks", taskId);
  }

  async #analysisRoot(taskId: string): Promise<string> {
    const root = join(this.#taskRoot(taskId), "analysis");
    await mkdir(root, { recursive: true });
    return root;
  }

  async #readText(path: string): Promise<string> {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      throw new TaskError({ code: "TASK_ARTIFACT_MISSING", message: `无法读取任务正文：${path}`, action: "view_partial_result", cause: error });
    }
  }

  #string(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  async #writeJson(path: string, value: unknown): Promise<void> {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}
