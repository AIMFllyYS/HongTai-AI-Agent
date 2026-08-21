import { TaskError, safeUrlForDisplay } from "@hongtai/core";
import type {
  AppTaskRecord,
  MediaReference,
  TaskDetailRecord,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
} from "@hongtai/core";

export const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

interface TaskMediaFiles {
  getUri(options: { readonly taskId: string; readonly relativePath: string }): Promise<{
    readonly uri?: string;
    readonly sizeBytes?: number;
    readonly mimeType?: string;
  }>;
}

function taskError(
  code: ConstructorParameters<typeof TaskError>[0]["code"],
  message: string,
  action: ConstructorParameters<typeof TaskError>[0]["action"] = "none",
): TaskError {
  return new TaskError({ code, message, action });
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return value === "queued" || value === "running" || value === "succeeded" || value === "degraded" ||
    value === "failed" || value === "cancelled" || value === "interrupted";
}

export function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined;
}

export function toAppTask(task: TaskRecord, media: readonly MediaReference[] = []): AppTaskRecord {
  if (!TASK_ID_PATTERN.test(task.id) || !isTaskStatus(task.status)) {
    throw taskError("TASK_ARTIFACT_MISSING", "本地任务记录格式无效", "view_partial_result");
  }
  return {
    id: task.id,
    sourceUrl: task.sourceKind === "local_video" ? "" : safeUrlForDisplay(task.sourceUrl),
    sourceKind: task.sourceKind ?? "public_link",
    status: task.status,
    ...(task.currentStage ? { currentStage: task.currentStage } : {}),
    ...(task.platform ? { platform: task.platform } : {}),
    ...(task.contentType ? { contentType: task.contentType } : {}),
    ...(task.speechStatus ? { speechStatus: task.speechStatus } : {}),
    analysisStatus: task.analysisStatus ?? "not_started",
    ...(task.retryOfTaskId ? { retryOfTaskId: task.retryOfTaskId } : {}),
    ...(task.cancelRequestedAt ? { cancelRequestedAt: task.cancelRequestedAt } : {}),
    ...(task.cancelledAt ? { cancelledAt: task.cancelledAt } : {}),
    ...(task.interruptedAt ? { interruptedAt: task.interruptedAt } : {}),
    media,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    issues: task.issues,
  };
}

export function eventFromJson(value: unknown): TaskEventRecord | undefined {
  const record = asRecord(value);
  const sequence = record?.sequence;
  if (!record || typeof record.taskId !== "string" || typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1) return undefined;
  if (record.kind === "task-status") return record as unknown as TaskEventRecord;
  if (typeof record.stage !== "string" || typeof record.status !== "string" || typeof record.message !== "string" || typeof record.timestamp !== "string") return undefined;
  return record as unknown as TaskEventRecord;
}

function contentString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function contentCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || !Number.isSafeInteger(value)) {
    return undefined;
  }
  return value;
}

function assignedEngagement(details: Readonly<Record<string, unknown>>): {
  readonly likeCount?: number;
  readonly favoriteCount?: number;
  readonly commentCount?: number;
  readonly shareCount?: number;
  readonly playCount?: number;
} {
  const likeCount = contentCount(details.likeCount);
  const favoriteCount = contentCount(details.favoriteCount);
  const commentCount = contentCount(details.commentCount);
  const shareCount = contentCount(details.shareCount);
  const playCount = contentCount(details.playCount);
  return {
    ...(likeCount === undefined ? {} : { likeCount }),
    ...(favoriteCount === undefined ? {} : { favoriteCount }),
    ...(commentCount === undefined ? {} : { commentCount }),
    ...(shareCount === undefined ? {} : { shareCount }),
    ...(playCount === undefined ? {} : { playCount }),
  };
}

export function projectTaskDetail(
  task: TaskRecord,
  media: readonly MediaReference[],
  metadata: unknown,
  transcriptText: string | undefined,
  transcriptInfo: unknown,
  contentText: string | undefined,
): TaskDetailRecord {
  const details = asRecord(metadata) ?? {};
  const title = contentString(details.title);
  const description = contentString(details.description);
  const author = contentString(details.author);
  const canonicalUrl = contentString(details.canonicalUrl);
  const durationSeconds = typeof details.durationSeconds === "number" && Number.isFinite(details.durationSeconds)
    ? details.durationSeconds
    : undefined;
  const content = {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    ...(canonicalUrl ? { canonicalUrl: safeUrlForDisplay(canonicalUrl) } : {}),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...assignedEngagement(details),
  };

  if (task.contentType === "image_text") {
    const text = contentText?.trim();
    const paragraphs = text ? text.split(/\r?\n+/).map((item) => item.trim()).filter(Boolean) : [];
    const evidenceUnits = paragraphs.map((textValue, index) => ({ id: `image-text-${index + 1}`, source: "image_text" as const, text: textValue }));
    return {
      task: toAppTask(task, media),
      content,
      media,
      imageText: { ...(text ? { text } : {}), images: media.filter((item) => item.kind === "image"), paragraphs: evidenceUnits },
      evidenceUnits,
    };
  }

  const transcriptDetails = asRecord(transcriptInfo) ?? {};
  const source = transcriptDetails.source === "asr" ? "asr" as const : "description" as const;
  const storedSegments = Array.isArray(transcriptDetails.segments) ? transcriptDetails.segments : [];
  const segments = storedSegments.flatMap((value, index) => {
    const item = asRecord(value);
    const textValue = contentString(item?.text);
    if (!textValue) return [];
    return [{
      id: `transcript-${index + 1}`,
      source: "transcript" as const,
      text: textValue,
      ...(typeof item?.startSeconds === "number" ? { startSeconds: item.startSeconds } : {}),
      ...(typeof item?.endSeconds === "number" ? { endSeconds: item.endSeconds } : {}),
    }];
  });
  const evidenceUnits = segments.length > 0
    ? segments
    : transcriptText?.trim()
      ? [{ id: "transcript-1", source: "transcript" as const, text: transcriptText.trim() }]
      : [];
  const transcript = evidenceUnits.length > 0
    ? { source, ...(transcriptText?.trim() ? { text: transcriptText.trim() } : {}), segments: evidenceUnits }
    : undefined;
  return { task: toAppTask(task, media), content, media, ...(transcript ? { transcript } : {}), evidenceUnits };
}

export async function projectTaskMedia(
  task: TaskRecord,
  files: TaskMediaFiles,
  toDisplayUri: (nativeUri: string) => string,
  readJson: (taskId: string, relativePath: string) => Promise<unknown>,
): Promise<readonly MediaReference[]> {
  const media: MediaReference[] = [];
  if (task.contentType === "video") {
    const video = await mediaReference(
      files,
      toDisplayUri,
      task.id,
      "media/video.mp4",
      "video",
      task.sourceKind === "local_video" ? "本地上传视频" : "下载的视频",
      task.sourceKind === "local_video" ? "imported" : "downloaded",
    );
    if (video) media.push(video);
  }
  if (task.contentType === "image_text") {
    const metadata = asRecord(await readJson(task.id, "metadata.json"));
    const images = Array.isArray(metadata?.images) ? metadata.images : [];
    for (let index = 0; index < images.length && index < 100; index += 1) {
      const image = await mediaReference(files, toDisplayUri, task.id, `media/images/image-${index}.bin`, "image", `已保存图片 ${index + 1}`);
      if (image) media.push(image);
    }
  }
  return media;
}

async function mediaReference(
  files: TaskMediaFiles,
  toDisplayUri: (nativeUri: string) => string,
  taskId: string,
  relativePath: string,
  kind: MediaReference["kind"],
  displayName: string,
  origin: MediaReference["origin"] = "downloaded",
): Promise<MediaReference | undefined> {
  const result = await files.getUri({ taskId, relativePath });
  if (!result.uri) return undefined;
  return {
    uri: toDisplayUri(result.uri),
    kind,
    origin,
    ...(result.mimeType ? { mimeType: result.mimeType } : {}),
    ...(Number.isFinite(result.sizeBytes) ? { byteLength: result.sizeBytes } : {}),
    displayName,
  };
}
