import type { ArtifactStore, MediaSource, TaskPaths } from "@hongtai/core";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const TASK_URI_PREFIX = "task://";

export interface LocalTaskFilesPlugin {
  /** Creates the fixed app-private directory for one task. */
  ensure(options: { readonly taskId: string }): Promise<void>;
  /** Replaces one small structured artifact atomically. */
  writeText(options: {
    readonly taskId: string;
    readonly relativePath: string;
    readonly value: string;
    readonly replace: boolean;
  }): Promise<void>;
  /** Appends an immutable event line to one fixed task artifact. */
  appendText(options: {
    readonly taskId: string;
    readonly relativePath: string;
    readonly value: string;
  }): Promise<void>;
}

export interface ParsedTaskPath {
  readonly taskId: string;
  readonly relativePath: string;
}

function validTaskId(taskId: string): string {
  if (!TASK_ID_PATTERN.test(taskId)) throw new TypeError("Task path has an invalid task id");
  return taskId;
}

function taskPath(taskId: string, relativePath: string): string {
  return `${TASK_URI_PREFIX}${validTaskId(taskId)}/${relativePath}`;
}

/**
 * Decodes only the logical URI form produced in this module.  It is not a
 * generic URL or filesystem parser: native code remains the sole owner of
 * the actual app-private path.
 */
export function parseTaskPath(value: string): ParsedTaskPath {
  if (!value.startsWith(TASK_URI_PREFIX)) throw new TypeError("Task path must use the private task URI form");
  const logicalPath = value.slice(TASK_URI_PREFIX.length);
  const separator = logicalPath.indexOf("/");
  if (separator <= 0 || separator === logicalPath.length - 1) throw new TypeError("Task path is invalid");
  const taskId = logicalPath.slice(0, separator);
  const relativePath = logicalPath.slice(separator + 1);
  if (relativePath.includes("?") || relativePath.includes("#") || relativePath.includes("%") ||
      relativePath.split("/").some((part) => !part || part === "." || part === ".." || part.includes("\\") || hasAsciiControlCharacter(part))) {
    throw new TypeError("Task path is invalid");
  }
  return { taskId: validTaskId(taskId), relativePath };
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function pathsFor(taskId: string): TaskPaths {
  const root = `${TASK_URI_PREFIX}${taskId}`;
  return {
    root,
    task: taskPath(taskId, "task.json"),
    log: taskPath(taskId, "events.jsonl"),
    metadata: taskPath(taskId, "metadata.json"),
    rawResponse: taskPath(taskId, "raw/response.json"),
    rawPage: taskPath(taskId, "raw/page.html"),
    video: taskPath(taskId, "media/video.mp4"),
    videoPart: taskPath(taskId, "media/video-source.bin"),
    audioPart: taskPath(taskId, "media/audio-source.bin"),
    audio: taskPath(taskId, "media/audio.wav"),
    imageDirectory: taskPath(taskId, "media/images"),
    contentText: taskPath(taskId, "content/content.txt"),
    segmentDirectory: taskPath(taskId, "media/segments"),
    transcript: taskPath(taskId, "transcript/transcript.txt"),
    transcriptJson: taskPath(taskId, "transcript/transcript.json"),
    draft: taskPath(taskId, "transcript/draft.txt"),
  };
}

/**
 * The smallest Android ArtifactStore adapter: it owns logical task paths,
 * while Kotlin owns private file locations and atomic writes.  No task stage,
 * parser, prompt, schema, or UI DTO is defined here.
 */
export class NativeTaskFiles implements ArtifactStore {
  readonly #plugin: LocalTaskFilesPlugin;
  readonly #initialized = new Set<string>();

  constructor(plugin: LocalTaskFilesPlugin) {
    this.#plugin = plugin;
  }

  async initializeTask(taskId: string, _outputDirectory?: string): Promise<TaskPaths> {
    void _outputDirectory;
    const normalizedTaskId = validTaskId(taskId);
    await this.#plugin.ensure({ taskId: normalizedTaskId });
    this.#initialized.add(normalizedTaskId);
    return pathsFor(normalizedTaskId);
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    await this.writeText(path, JSON.stringify(value));
  }

  async writeText(path: string, value: string): Promise<void> {
    const parsed = this.#ownedPath(path);
    // The standalone app deliberately keeps only UI-safe task artifacts. Raw
    // platform payloads remain a CLI debugging concern and must not turn a
    // successful task into a storage failure on a client device.
    if (parsed.relativePath.startsWith("raw/")) return;
    await this.#plugin.writeText({ ...parsed, value, replace: true });
  }

  async appendText(path: string, value: string): Promise<void> {
    const parsed = this.#ownedPath(path);
    await this.#plugin.appendText({ ...parsed, value });
  }

  imagePath(paths: TaskPaths, index: number, _source: MediaSource): string {
    void _source;
    if (!Number.isInteger(index) || index < 0 || index > 99) throw new TypeError("Image index is invalid");
    const { taskId } = this.#ownedPath(paths.imageDirectory);
    return taskPath(taskId, `media/images/image-${index}.bin`);
  }

  #ownedPath(path: string): ParsedTaskPath {
    const parsed = parseTaskPath(path);
    if (!this.#initialized.has(parsed.taskId)) throw new TypeError("Task path does not belong to an initialized task");
    return parsed;
  }
}
