import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { extname, resolve, join } from "node:path";
import type { ArtifactStore, MediaSource, TaskPaths } from "@hongtai/core";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

export class FileArtifactStore implements ArtifactStore {
  readonly #workspaceDirectory: string;

  constructor(workspaceDirectory: string) {
    this.#workspaceDirectory = resolve(workspaceDirectory);
  }

  async initializeTask(taskId: string, outputDirectory?: string): Promise<TaskPaths> {
    if (!/^[a-zA-Z0-9-]+$/.test(taskId)) throw new Error("任务ID格式无效");
    const base = outputDirectory ? resolve(outputDirectory) : join(this.#workspaceDirectory, "tasks");
    const root = join(base, taskId);
    const raw = join(root, "raw");
    const media = join(root, "media");
    const transcript = join(root, "transcript");
    const imageDirectory = join(media, "images");
    const content = join(root, "content");
    const segmentDirectory = join(media, "segments");
    await Promise.all([
      mkdir(raw, { recursive: true }),
      mkdir(media, { recursive: true }),
      mkdir(transcript, { recursive: true }),
      mkdir(imageDirectory, { recursive: true }),
      mkdir(content, { recursive: true }),
      mkdir(segmentDirectory, { recursive: true }),
    ]);
    return {
      root,
      task: join(root, "task.json"),
      log: join(root, "task.log"),
      metadata: join(root, "metadata.json"),
      rawResponse: join(raw, "response.json"),
      rawPage: join(raw, "page.html"),
      video: join(media, "video.mp4"),
      videoPart: join(media, "video-only.m4s"),
      audioPart: join(media, "audio-only.m4s"),
      audio: join(media, "audio.wav"),
      imageDirectory,
      contentText: join(content, "content.txt"),
      segmentDirectory,
      transcript: join(transcript, "transcript.txt"),
      transcriptJson: join(transcript, "transcript.json"),
      draft: join(transcript, "draft.txt"),
    };
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  async writeText(path: string, value: string): Promise<void> {
    await writeFile(path, value, "utf8");
  }

  async appendText(path: string, value: string): Promise<void> {
    await appendFile(path, value, "utf8");
  }

  imagePath(paths: TaskPaths, index: number, source: MediaSource): string {
    let extension = ".jpg";
    try {
      const candidate = extname(new URL(source.url).pathname).toLowerCase();
      if (IMAGE_EXTENSIONS.has(candidate)) extension = candidate === ".jpeg" ? ".jpg" : candidate;
    } catch {
      // 媒体源URL已在下载器再次校验；这里只选择安全文件扩展名。
    }
    return join(paths.imageDirectory, `image-${String(index + 1).padStart(3, "0")}${extension}`);
  }
}
