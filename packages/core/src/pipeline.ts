import type { IngestPipelineDependencies } from "./contracts";
import {
  TASK_STAGE_VALUES,
} from "./models";
import type {
  IngestRequest,
  IngestResult,
  MediaSource,
  PlatformContent,
  ProgressEvent,
  ResolvedLink,
  SpeechStatus,
  StageStatus,
  TaskRecord,
  TaskPaths,
  TaskStage,
} from "./models";
import { TaskError, issueFromError, safeUrlForDisplay, warningIssue } from "./errors";
import { normalizeInput } from "./input";

export const PIPELINE_STAGES = [
  ...TASK_STAGE_VALUES,
] as const;

const DEFAULT_MAX_DURATION_SECONDS = 1_200;
const SEGMENT_SECONDS = 30;

function createTaskId(): string {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${suffix}`;
}

function taskIdFor(request: IngestRequest): string {
  if (request.taskId === undefined) return createTaskId();
  const taskId = request.taskId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(taskId)) {
    throw new TaskError({ code: "INPUT_URL_INVALID", message: "本地任务标识格式无效", action: "edit_input" });
  }
  return taskId;
}

function mediaSourceForStorage(source: MediaSource): Omit<MediaSource, "headers"> {
  return {
    kind: source.kind,
    url: safeUrlForDisplay(source.url),
    quality: source.quality,
    codec: source.codec,
    mimeType: source.mimeType,
    bitrate: source.bitrate,
    width: source.width,
    height: source.height,
    hasWatermark: source.hasWatermark,
  };
}

function platformContentForStorage(content: PlatformContent): PlatformContent {
  return {
    ...content,
    // Raw platform payloads are debugging input, not presentation metadata.
    // Keeping this undefined also makes JSON serialization omit the field.
    raw: undefined,
    sourceUrl: safeUrlForDisplay(content.sourceUrl),
    canonicalUrl: content.canonicalUrl ? safeUrlForDisplay(content.canonicalUrl) : undefined,
    coverUrl: content.coverUrl ? safeUrlForDisplay(content.coverUrl) : undefined,
    videos: content.videos.map(mediaSourceForStorage),
    audios: content.audios.map(mediaSourceForStorage),
    images: content.images.map(mediaSourceForStorage),
    subtitles: content.subtitles.map((subtitle) => ({
      ...subtitle,
      url: subtitle.url ? safeUrlForDisplay(subtitle.url) : undefined,
    })),
  };
}

function sourceScore(source: MediaSource): number {
  const pixels = (source.width ?? 0) * (source.height ?? 0);
  const bitrate = source.bitrate ?? 0;
  const watermarkPenalty = source.hasWatermark === true ? 1_000_000_000_000 : 0;
  return pixels * 1_000 + bitrate - watermarkPenalty;
}

function selectBest(sources: readonly MediaSource[]): MediaSource | undefined {
  return [...sources].sort((left, right) => sourceScore(right) - sourceScore(left))[0];
}

export class IngestPipeline {
  readonly #dependencies: IngestPipelineDependencies;

  constructor(dependencies: IngestPipelineDependencies) {
    this.#dependencies = dependencies;
  }

  async run(request: IngestRequest): Promise<IngestResult> {
    const taskId = taskIdFor(request);
    const createdAt = new Date().toISOString();
    let progressSequence = 0;
    const issues: import("./models").TaskIssue[] = [];
    let paths: TaskPaths;
    try {
      paths = await this.#dependencies.store.initializeTask(taskId, request.outputDirectory);
    } catch (error) {
      const issue = issueFromError(error, "save-artifacts");
      issues.push(issue);
      await this.#dependencies.reporter.report({
        taskId,
        sequence: ++progressSequence,
        stage: "save-artifacts",
        status: "failed",
        message: `失败：${issue.userMessage}`,
        issue,
        timestamp: new Date().toISOString(),
      });
      return { taskId, status: "failed", issues };
    }
    let currentStage: TaskStage = "detect-platform";
    let platform: PlatformContent["platform"] | undefined;
    let contentType: PlatformContent["contentType"] | undefined;
    let sourceUrl = "";
    let videoDownloaded = false;
    let transcriptWritten = false;
    let draftWritten = false;
    let speechStatus: SpeechStatus | undefined;
    let transcriptSource: "asr" | "description" | "none" | undefined;
    let resolvedLink: ResolvedLink | undefined;

    const writeTask = async (status: TaskRecord["status"]): Promise<void> => {
      const task: TaskRecord = {
        id: taskId,
        sourceUrl,
        status,
        currentStage,
        platform,
        contentType,
        speechStatus,
        analysisStatus: "not_started",
        createdAt,
        updatedAt: new Date().toISOString(),
        issues,
        paths,
      };
      await this.#dependencies.store.writeJson(paths.task, task);
    };

    const report = async (
      stage: TaskStage,
      status: StageStatus,
      message: string,
      extra: Partial<Pick<ProgressEvent, "progress" | "detail">> = {},
      issue?: import("./models").TaskIssue,
    ): Promise<void> => {
      currentStage = stage;
      const event: ProgressEvent = {
        taskId,
        sequence: ++progressSequence,
        stage,
        status,
        message,
        progress: extra.progress,
        detail: extra.detail,
        issue,
        timestamp: new Date().toISOString(),
      };
      await this.#dependencies.reporter.report(event);
      await this.#dependencies.store.appendText(paths.log, `${JSON.stringify(event)}\n`);
    };

    const complete = async <T>(
      stage: TaskStage,
      startMessage: string,
      operation: () => Promise<T>,
      finishMessage: (value: T, elapsedMs: number) => string,
      finishExtra?: (value: T) => Partial<Pick<ProgressEvent, "progress" | "detail">>,
    ): Promise<T> => {
      const started = Date.now();
      await report(stage, "running", startMessage);
      const value = await operation();
      await report(stage, "succeeded", finishMessage(value, Date.now() - started), finishExtra?.(value));
      await writeTask("running");
      return value;
    };

    await writeTask("running");

    try {
      const detected = await complete(
        "detect-platform",
        "开始识别平台",
        async () => {
          const normalized = normalizeInput(request.input);
          const adapter = this.#dependencies.adapters.find((candidate) => candidate.platform === normalized.platform);
          if (!adapter) {
            throw new TaskError({ code: "INPUT_PLATFORM_UNSUPPORTED", message: "当前只支持抖音、小红书、B站和快手链接", action: "edit_input" });
          }
          platform = adapter.platform;
          sourceUrl = normalized.normalizedUrl;
          return { adapter, normalized };
        },
        (value, elapsedMs) => `完成：${value.adapter.platform}${value.normalized.ignoredSupportedUrlCount > 0 ? `，已忽略其他${value.normalized.ignoredSupportedUrlCount}个链接` : ""}，耗时 ${elapsedMs}ms`,
        (value) => ({
          detail: {
            normalizedUrl: safeUrlForDisplay(value.normalized.normalizedUrl),
            ignoredSupportedUrlCount: value.normalized.ignoredSupportedUrlCount,
          },
        }),
      );
      const adapter = detected.adapter;

      const resolved = await complete(
        "resolve-link",
        `开始：${sourceUrl}`,
        async () => adapter.resolve(sourceUrl, this.#dependencies.http),
        (value, elapsedMs) => `完成：最终链接 ${safeUrlForDisplay(value.finalUrl)}，耗时 ${elapsedMs}ms`,
      );
      resolvedLink = resolved;
      if (resolved.body) {
        await this.#dependencies.store.writeText(paths.rawPage, resolved.body);
      }

      const content = await complete(
        "parse-content",
        "开始提取页面和平台数据",
        async () => adapter.parse(resolved, this.#dependencies.http),
        (value, elapsedMs) =>
          `完成：标题=${value.title || "未知"}，作者=${value.author || "未知"}，视频源=${value.videos.length}个，耗时 ${elapsedMs}ms`,
      );
      contentType = content.contentType;
      await this.#dependencies.store.writeJson(paths.rawResponse, content.raw);
      await this.#dependencies.store.writeJson(paths.metadata, platformContentForStorage(content));

      if (content.contentType === "image_text") {
        const textParts = [content.title, content.description]
          .map((value) => value?.trim())
          .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
        const contentText = textParts.join("\n\n");

        await report("select-media", "running", "开始选择图文资源");
        if (content.images.length > 0) {
          await report("select-media", "succeeded", `完成：图片=${content.images.length}张，正文=${contentText.length}字`);
        } else {
          const issue = warningIssue("MEDIA_SOURCE_NOT_FOUND", "select-media", "图文笔记中没有找到可下载图片", { action: "view_partial_result", platform });
          issues.push(issue);
          await report("select-media", "degraded", issue.userMessage, {}, issue);
        }

        const imagePaths: string[] = [];
        await report("download-media", "running", `开始下载${content.images.length}张图片`);
        for (let index = 0; index < content.images.length; index += 1) {
          const source = content.images[index];
          if (!source) continue;
          const destination = this.#dependencies.store.imagePath(paths, index, source);
          try {
            await this.#downloadSource(taskId, "download-media", source, destination, report);
            imagePaths.push(destination);
          } catch (error) {
            const base = issueFromError(error, "download-media", platform);
            const issue = warningIssue("MEDIA_DOWNLOAD_FAILED", "download-media", `第${index + 1}张图片下载失败`, {
              action: "view_partial_result",
              platform,
              retryable: base.retryable,
              details: { imageIndex: index + 1 },
            });
            issues.push(issue);
            await report("download-media", "degraded", issue.userMessage, {}, issue);
          }
        }
        await report(
          "download-media",
          imagePaths.length === content.images.length ? "succeeded" : "degraded",
          `完成：已保存 ${imagePaths.length}/${content.images.length} 张图片`,
        );

        await report("obtain-transcript", "running", "图文笔记无需语音转写，开始保存正文");
        let contentTextWritten = false;
        if (contentText) {
          await this.#dependencies.store.writeText(paths.contentText, `${contentText}\n`);
          contentTextWritten = true;
          await report("obtain-transcript", "succeeded", `完成：图文正文 ${contentText.length} 字`);
        } else {
          const issue = warningIssue("CONTENT_NOT_FOUND", "obtain-transcript", "图文笔记没有可保存的标题或正文", { action: "view_partial_result", platform });
          issues.push(issue);
          await report("obtain-transcript", "degraded", issue.userMessage, {}, issue);
        }

        await report("save-artifacts", "running", "开始保存图文任务结果");
        const hasArtifacts = contentTextWritten || imagePaths.length > 0;
        const finalStatus = !hasArtifacts ? "failed" : issues.length > 0 ? "degraded" : "succeeded";
        if (!hasArtifacts) {
          issues.push(issueFromError(new TaskError({ code: "CONTENT_NOT_FOUND", message: "没有保存到任何图文内容", action: "retry" }), "save-artifacts", platform));
        }
        await writeTask(finalStatus);
        await report("save-artifacts", hasArtifacts ? "succeeded" : "failed", `完成：${paths.root}`);
        return {
          taskId,
          status: finalStatus,
          platform,
          contentType,
          imagePaths,
          contentTextPath: contentTextWritten ? paths.contentText : undefined,
          issues,
        };
      }

      const selection = await complete(
        "select-media",
        "开始选择最佳媒体源",
        async () => ({ video: selectBest(content.videos), audio: selectBest(content.audios) }),
        (value, elapsedMs) =>
          `${value.video
            ? `完成：${value.video.quality || "未知画质"}，${value.video.codec || "未知编码"}，${value.video.hasWatermark === false ? "无水印" : "水印状态未知"}`
            : "降级：没有找到可下载的视频源"}，耗时 ${elapsedMs}ms`,
      );

      if (!selection.video) {
        const issue = warningIssue("MEDIA_SOURCE_NOT_FOUND", "select-media", "页面已解析，但没有找到可下载的视频源", { action: "view_partial_result", platform });
        issues.push(issue);
        await report("select-media", "degraded", issue.userMessage, {}, issue);
        await report("save-artifacts", "running", "开始保存降级任务结果");
        await writeTask("degraded");
        await report("save-artifacts", "succeeded", `完成：${paths.root}`);
        return { taskId, status: "degraded", platform, contentType, issues };
      }

      const maxDuration = request.maxDurationSeconds ?? DEFAULT_MAX_DURATION_SECONDS;
      if (content.durationSeconds && content.durationSeconds > maxDuration) {
        throw new TaskError({ code: "MEDIA_DURATION_EXCEEDED", message: `视频时长 ${Math.ceil(content.durationSeconds)} 秒，超过首版限制 ${maxDuration} 秒`, action: "edit_input", details: { durationSeconds: Math.ceil(content.durationSeconds), maxDurationSeconds: maxDuration } });
      }

      await complete(
        "download-media",
        "开始下载视频",
        async () => {
          if (selection.audio) {
            await this.#downloadSource(taskId, "download-media", selection.video!, paths.videoPart, report);
            await this.#downloadSource(taskId, "download-media", selection.audio, paths.audioPart, report);
            await this.#dependencies.mediaTools.merge(paths.videoPart, paths.audioPart, paths.video);
          } else {
            await this.#downloadSource(taskId, "download-media", selection.video!, paths.video, report);
          }
          videoDownloaded = true;
          return paths.video;
        },
        (value, elapsedMs) => `完成：${value}，耗时 ${elapsedMs}ms`,
      );

      await report("obtain-transcript", "running", "开始读取视频并准备文稿");
      const duration = await this.#dependencies.mediaTools.probeDuration(paths.video);
      if (duration > maxDuration) {
        throw new TaskError({ code: "MEDIA_DURATION_EXCEEDED", message: `视频时长 ${Math.ceil(duration)} 秒，超过首版限制 ${maxDuration} 秒`, action: "edit_input", details: { durationSeconds: Math.ceil(duration), maxDurationSeconds: maxDuration } });
      }

      await report("obtain-transcript", "running", `媒体校验通过：时长=${Math.ceil(duration)}秒`);
      let transcript = "";
      let segments: import("./models").TranscriptionResult["segments"] = [];
      let completedCharacters = 0;

      if (this.#dependencies.transcriber) {
        try {
          await this.#dependencies.mediaTools.extractAudio(paths.video, paths.audio);
          const segmentPaths = await this.#dependencies.mediaTools.splitAudio(
            paths.audio,
            paths.segmentDirectory,
            SEGMENT_SECONDS,
          );
          await report("obtain-transcript", "running", `音频分段=${segmentPaths.length}个`);
          const transcription = await this.#dependencies.transcriber.transcribe(
            segmentPaths,
            SEGMENT_SECONDS,
            async (segment, completed, total) => {
              completedCharacters += segment.text.length;
              const segmentMessage = segment.status === "failed"
                ? "失败"
                : segment.status === "no_speech" ? "未检测到口播" : "完成";
              await report(
                "obtain-transcript",
                segment.status === "failed" ? "degraded" : "running",
                `转写 ${completed}/${total}，当前分段=${segmentMessage}，已生成约 ${completedCharacters} 字`,
                {},
                segment.issue,
              );
            },
          );
          speechStatus = transcription.status;
          segments = transcription.segments;
          transcript = transcription.text;
          if (transcript) transcriptSource = "asr";
          const failedSegments = segments.filter((segment) => segment.status === "failed");
          if (failedSegments.length > 0) {
            const segmentIssue = failedSegments.find((segment) => segment.issue)?.issue;
            if (segmentIssue) {
              issues.push({
                ...segmentIssue,
                severity: "warning",
                platform,
                details: { ...segmentIssue.details, failedSegments: failedSegments.length },
              });
            }
            issues.push(warningIssue("ASR_PARTIAL_FAILURE", "obtain-transcript", `语音转写部分失败：${failedSegments.length}/${segments.length}个分段未完成`, { action: "view_partial_result", platform, details: { failedSegments: failedSegments.length, totalSegments: segments.length } }));
          }
        } catch (error) {
          speechStatus = "failed";
          const issue = issueFromError(error, "obtain-transcript", platform);
          issues.push({ ...issue, severity: "warning", action: "view_partial_result" });
        }
      } else {
        speechStatus = "failed";
        issues.push(warningIssue("AI_NOT_CONFIGURED", "obtain-transcript", "未配置AI API Key，跳过语音转写", { action: "configure_ai", platform }));
      }

      if (speechStatus !== "no_speech" && !transcript && content.description) {
        transcript = content.description;
        transcriptSource = "description";
        issues.push(warningIssue("AI_EMPTY_RESPONSE", "obtain-transcript", "没有获得语音转写，已使用平台描述作为降级文稿", { action: "view_partial_result", platform }));
      }

      if (transcript) {
        await this.#dependencies.store.writeText(paths.transcript, `${transcript.trim()}\n`);
        transcriptWritten = true;
      }
      if (segments.length > 0 || transcriptWritten) {
        await this.#dependencies.store.writeJson(paths.transcriptJson, {
          speechStatus,
          source: speechStatus === "no_speech" ? "none" : transcriptSource ?? "description",
          durationSeconds: duration,
          segments,
        });
      }

      if (transcript && this.#dependencies.rewriter) {
        try {
          const draft = await this.#dependencies.rewriter.rewrite(transcript);
          if (draft.trim()) {
            await this.#dependencies.store.writeText(paths.draft, `${draft.trim()}\n`);
            draftWritten = true;
            await report("obtain-transcript", "running", `整理稿完成：${draft.trim().length} 字`);
          }
        } catch (error) {
          const base = issueFromError(error, "obtain-transcript", platform);
          issues.push(warningIssue("TEXT_REWRITE_FAILED", "obtain-transcript", `整理稿生成失败：${base.userMessage}`, { action: "view_partial_result", platform }));
        }
      }

      const transcriptStatus = speechStatus === "no_speech"
        ? "succeeded"
        : transcriptWritten ? (issues.length > 0 ? "degraded" : "succeeded") : "failed";
      await report(
        "obtain-transcript",
        transcriptStatus,
        speechStatus === "no_speech"
          ? "完成：未检测到有效口播，无需生成文稿"
          : transcriptWritten
            ? `完成：原始文稿 ${transcript.length} 字${draftWritten ? "，整理稿已生成" : ""}`
            : "失败：没有生成任何文稿",
      );

      await report("save-artifacts", "running", "开始保存最终任务结果");
      const finalStatus = videoDownloaded && (transcriptWritten || speechStatus === "no_speech")
        ? issues.length > 0 ? "degraded" : "succeeded"
        : "failed";
      await writeTask(finalStatus);
      await report("save-artifacts", "succeeded", `完成：${paths.root}`);

      return {
        taskId,
        status: finalStatus,
        platform,
        contentType,
        speechStatus,
        videoPath: videoDownloaded ? paths.video : undefined,
        transcriptPath: transcriptWritten ? paths.transcript : undefined,
        draftPath: draftWritten ? paths.draft : undefined,
        issues,
      };
    } catch (error) {
      const failureStage = currentStage as TaskStage;
      const issue = issueFromError(error, failureStage, platform);
      issues.push(issue);
      await report(failureStage, "failed", `失败：${issue.userMessage}`, {}, issue);
      if (failureStage === "resolve-link" || failureStage === "parse-content") {
        await this.#dependencies.store.writeJson(paths.rawResponse, {
          stage: failureStage,
          errorCode: issue.code,
          error: issue.userMessage,
          finalUrl: resolvedLink?.finalUrl ? safeUrlForDisplay(resolvedLink.finalUrl) : undefined,
          httpStatus: resolvedLink?.status,
          details: issue.details,
          pageSummary: resolvedLink?.body
            ?.replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 500),
        });
      }
      await writeTask("failed");
      return {
        taskId,
        status: "failed",
        platform,
        contentType,
        speechStatus,
        videoPath: videoDownloaded ? paths.video : undefined,
        transcriptPath: transcriptWritten ? paths.transcript : undefined,
        draftPath: draftWritten ? paths.draft : undefined,
        issues,
      };
    }
  }

  async #downloadSource(
    _taskId: string,
    stage: TaskStage,
    source: MediaSource,
    destination: string,
    report: (
      stage: TaskStage,
      status: StageStatus,
      message: string,
      extra?: Partial<Pick<ProgressEvent, "progress" | "detail">>,
    ) => Promise<void>,
  ): Promise<void> {
    let lastReportedAt = 0;
    let lastProgress: number | undefined;
    const mediaLabel = source.kind === "audio" ? "音频流" : source.kind === "image" ? "图片" : "视频流";
    await this.#dependencies.downloader.download(source, destination, async (progress) => {
      const now = Date.now();
      if (progress.progress === 1 && lastProgress === 1) return;
      if (now - lastReportedAt < 1_000 && progress.progress !== 1) return;
      lastReportedAt = now;
      lastProgress = progress.progress;
      const percent = progress.progress == null ? "未知" : `${Math.round(progress.progress * 100)}%`;
      await report(stage, "running", `${mediaLabel}下载 ${percent}`, {
        progress: progress.progress,
        detail: {
          downloadedBytes: progress.downloadedBytes,
          totalBytes: progress.totalBytes,
          destination,
        },
      });
    });
  }
}
