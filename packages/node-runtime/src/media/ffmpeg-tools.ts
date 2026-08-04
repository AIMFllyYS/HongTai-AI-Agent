import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { TaskError, type ErrorCode, type MediaTools } from "@hongtai/core";

function mediaToolError(error: unknown, code: ErrorCode, message: string): TaskError {
  return error instanceof TaskError ? error : new TaskError({ code, message, action: "retry", cause: error });
}

async function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(`${command}执行失败（${code ?? "unknown"}）：${Buffer.concat(stderr).toString("utf8").slice(-1_000)}`));
    });
  });
}
export class FfmpegMediaTools implements MediaTools {
  async merge(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
    try {
      await run("ffmpeg", ["-y", "-i", videoPath, "-i", audioPath, "-c", "copy", "-movflags", "+faststart", outputPath]);
    } catch {
      try {
        await run("ffmpeg", ["-y", "-i", videoPath, "-i", audioPath, "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", outputPath]);
      } catch (error) {
        throw mediaToolError(error, "MEDIA_MERGE_FAILED", "音视频合并失败");
      }
    }
  }

  async probeDuration(mediaPath: string): Promise<number> {
    let output: string;
    try {
      output = await run("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        mediaPath,
      ]);
    } catch (error) {
      throw mediaToolError(error, "MEDIA_PROBE_FAILED", "无法读取视频信息");
    }
    const duration = Number(output.trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new TaskError({ code: "MEDIA_PROBE_FAILED", message: "无法读取视频时长", action: "retry" });
    return duration;
  }

  async extractAudio(videoPath: string, audioPath: string): Promise<void> {
    try {
      await run("ffmpeg", [
        "-y", "-i", videoPath,
        "-vn", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
        "-c:a", "pcm_s16le", audioPath,
      ]);
    } catch (error) {
      throw mediaToolError(error, "MEDIA_PROBE_FAILED", "视频音频提取失败");
    }
  }

  async splitAudio(audioPath: string, outputDirectory: string, segmentSeconds: number): Promise<readonly string[]> {
    await mkdir(outputDirectory, { recursive: true });
    try {
      await run("ffmpeg", [
        "-y", "-i", audioPath,
        "-f", "segment", "-segment_time", String(segmentSeconds), "-reset_timestamps", "1",
        "-c:a", "pcm_s16le", join(outputDirectory, "segment-%04d.wav"),
      ]);
    } catch (error) {
      throw mediaToolError(error, "MEDIA_PROBE_FAILED", "音频切片失败");
    }
    const files = (await readdir(outputDirectory))
      .filter((name) => /^segment-\d+\.wav$/i.test(name))
      .sort()
      .map((name) => join(outputDirectory, name));
    if (files.length === 0) throw new TaskError({ code: "MEDIA_PROBE_FAILED", message: "FFmpeg没有生成音频分段", action: "retry" });
    return files;
  }
}
