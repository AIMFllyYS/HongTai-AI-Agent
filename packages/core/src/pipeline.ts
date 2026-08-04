import type { IngestPipelineDependencies } from "./contracts";
import type {
  IngestRequest,
  IngestResult,
  MediaSource,
  PlatformContent,
  ProgressEvent,
  ResolvedLink,
  StageStatus,
  TaskRecord,
  TaskStage,
  TranscriptSegment,
} from "./models";
import { TaskError, issueFromError, warningIssue } from "./errors";
import { normalizeInput } from "./input";

export const PIPELINE_STAGES = [
  "detect-platform",
  "resolve-link",
  "parse-content",
  "select-media",
  "download-media",
  "obtain-transcript",
  "save-artifacts",
] as const satisfies readonly TaskStage[];

const DEFAULT_MAX_DURATION_SECONDS = 1_200;
const SEGMENT_SECONDS = 30;

function createTaskId(): string {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${suffix}`;
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
    const taskId = createTaskId();
    const createdAt = new Date().toISOString();
    const issues: import("./models").TaskIssue[] = [];
    const paths = await this.#dependencies.store.initializeTask(taskId, request.outputDirectory);
    let currentStage: TaskStage = "detect-platform";
    let platform: PlatformContent["platform"] | undefined;
    let contentType: PlatformContent["contentType"] | undefined;
    let sourceUrl = "";
    let videoDownloaded = false;
    let transcriptWritten = false;
    let draftWritten = false;
    let resolvedLink: ResolvedLink | undefined;

    const writeTask = async (status: TaskRecord["status"]): Promise<void> => {
      const task: TaskRecord = {
        id: taskId,
        sourceUrl,
        status,
        currentStage,
        platform,
        contentType,
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
    ): Promise<T> => {
      const started = Date.now();
      await report(stage, "running", startMessage);
      const value = await operation();
      await report(stage, "succeeded", finishMessage(value, Date.now() - started));
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
            throw new TaskError({ code: "INPUT_PLATFORM_UNSUPPORTED", message: "当前只支持抖音、小红书和B站链接", action: "edit_input" });
          }
          return { adapter, normalized };
        },
        (value, elapsedMs) => `完成：${value.adapter.platform}${value.normalized.ignoredSupportedUrlCount > 0 ? `，已忽略其他${value.normalized.ignoredSupportedUrlCount}个链接` : ""}，耗时 ${elapsedMs}ms`,
      );
      const adapter = detected.adapter;
      platform = adapter.platform;
      sourceUrl = detected.normalized.normalizedUrl;

      const resolved = await complete(
        "resolve-link",
        `开始：${sourceUrl}`,
        async () => adapter.resolve(sourceUrl, this.#dependencies.http),
        (value) => `完成：最终链接 ${value.finalUrl}`,
      );
      resolvedLink = resolved;
      if (resolved.body) {
        await this.#dependencies.store.writeText(paths.rawPage, resolved.body);
      }

      const content = await complete(
        "parse-content",
        "开始提取页面和平台数据",
        async () => adapter.parse(resolved, this.#dependencies.http),
        (value) =>
          `完成：标题=${value.title || "未知"}，作者=${value.author || "未知"}，视频源=${value.videos.length}个`,
      );
      contentType = content.contentType;
      await this.#dependencies.store.writeJson(paths.rawResponse, content.raw);
      await this.#dependencies.store.writeJson(paths.metadata, content);

      const selection = await complete(
        "select-media",
        "开始选择最佳媒体源",
        async () => ({ video: selectBest(content.videos), audio: selectBest(content.audios) }),
        (value) =>
          value.video
            ? `完成：${value.video.quality || "未知画质"}，${value.video.codec || "未知编码"}，${value.video.hasWatermark === false ? "无水印" : "水印状态未知"}`
            : "降级：没有找到可下载的视频源",
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
        (value) => `完成：${value}`,
      );

      await report("obtain-transcript", "running", "开始读取视频并准备文稿");
      const duration = await this.#dependencies.mediaTools.probeDuration(paths.video);
      if (duration > maxDuration) {
        throw new TaskError({ code: "MEDIA_DURATION_EXCEEDED", message: `视频时长 ${Math.ceil(duration)} 秒，超过首版限制 ${maxDuration} 秒`, action: "edit_input", details: { durationSeconds: Math.ceil(duration), maxDurationSeconds: maxDuration } });
      }

      await report("obtain-transcript", "running", `音频时长=${Math.ceil(duration)}秒`);
      let transcript = "";
      let segments: readonly TranscriptSegment[] = [];
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
          segments = await this.#dependencies.transcriber.transcribe(
            segmentPaths,
            SEGMENT_SECONDS,
            async (segment, completed, total) => {
              completedCharacters += segment.text.length;
              await report(
                "obtain-transcript",
                segment.status === "failed" ? "degraded" : "running",
                `转写 ${completed}/${total}，当前分段=${segment.status === "failed" ? "失败" : "完成"}，已生成约 ${completedCharacters} 字`,
              );
            },
          );
          const failedSegments = segments.filter((segment) => segment.status === "failed");
          if (failedSegments.length > 0) {
            issues.push(warningIssue("ASR_PARTIAL_FAILURE", "obtain-transcript", `语音转写部分失败：${failedSegments.length}/${segments.length}个分段未完成`, { action: "view_partial_result", platform, details: { failedSegments: failedSegments.length, totalSegments: segments.length } }));
          }
          transcript = segments
            .filter((segment) => segment.status === "succeeded")
            .map((segment) => segment.text.trim())
            .filter(Boolean)
            .join("\n");
        } catch (error) {
          const issue = issueFromError(error, "obtain-transcript", platform);
          issues.push({ ...issue, severity: "warning", action: "view_partial_result" });
        }
      } else {
        issues.push(warningIssue("AI_NOT_CONFIGURED", "obtain-transcript", "未配置AI API Key，跳过语音转写", { action: "configure_ai", platform }));
      }

      if (!transcript && content.description) {
        transcript = content.description;
        issues.push(warningIssue("AI_EMPTY_RESPONSE", "obtain-transcript", "没有获得语音转写，已使用平台描述作为降级文稿", { action: "view_partial_result", platform }));
      }

      if (transcript) {
        await this.#dependencies.store.writeText(paths.transcript, `${transcript.trim()}\n`);
        await this.#dependencies.store.writeJson(paths.transcriptJson, {
          source: segments.length > 0 ? "asr" : "description",
          durationSeconds: duration,
          segments,
        });
        transcriptWritten = true;
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

      const transcriptStatus = transcriptWritten ? (issues.length > 0 ? "degraded" : "succeeded") : "failed";
      await report(
        "obtain-transcript",
        transcriptStatus,
        transcriptWritten
          ? `完成：原始文稿 ${transcript.length} 字${draftWritten ? "，整理稿已生成" : ""}`
          : "失败：没有生成任何文稿",
      );

      await report("save-artifacts", "running", "开始保存最终任务结果");
      const finalStatus = videoDownloaded && transcriptWritten
        ? issues.length > 0 ? "degraded" : "succeeded"
        : "failed";
      await writeTask(finalStatus);
      await report("save-artifacts", "succeeded", `完成：${paths.root}`);

      return {
        taskId,
        status: finalStatus,
        platform,
        contentType,
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
          finalUrl: resolvedLink?.finalUrl,
          httpStatus: resolvedLink?.status,
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
    await this.#dependencies.downloader.download(source, destination, async (progress) => {
      const now = Date.now();
      if (progress.progress === 1 && lastProgress === 1) return;
      if (now - lastReportedAt < 1_000 && progress.progress !== 1) return;
      lastReportedAt = now;
      lastProgress = progress.progress;
      const percent = progress.progress == null ? "未知" : `${Math.round(progress.progress * 100)}%`;
      await report(stage, "running", `下载 ${percent}`, {
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
