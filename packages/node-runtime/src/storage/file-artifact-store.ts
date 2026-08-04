import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { ArtifactStore, TaskPaths } from "@hongtai/core";

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
    const segmentDirectory = join(media, "segments");
    await Promise.all([
      mkdir(raw, { recursive: true }),
      mkdir(media, { recursive: true }),
      mkdir(transcript, { recursive: true }),
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
}
