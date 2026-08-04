import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { MediaTools } from "@hongtai/core";

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
      await run("ffmpeg", ["-y", "-i", videoPath, "-i", audioPath, "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", outputPath]);
    }
  }

  async probeDuration(mediaPath: string): Promise<number> {
    const output = await run("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      mediaPath,
    ]);
    const duration = Number(output.trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取视频时长");
    return duration;
  }

  async extractAudio(videoPath: string, audioPath: string): Promise<void> {
    await run("ffmpeg", [
      "-y", "-i", videoPath,
      "-vn", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
      "-c:a", "pcm_s16le", audioPath,
    ]);
  }

  async splitAudio(audioPath: string, outputDirectory: string, segmentSeconds: number): Promise<readonly string[]> {
    await mkdir(outputDirectory, { recursive: true });
    await run("ffmpeg", [
      "-y", "-i", audioPath,
      "-f", "segment", "-segment_time", String(segmentSeconds), "-reset_timestamps", "1",
      "-c:a", "pcm_s16le", join(outputDirectory, "segment-%04d.wav"),
    ]);
    const files = (await readdir(outputDirectory))
      .filter((name) => /^segment-\d+\.wav$/i.test(name))
      .sort()
      .map((name) => join(outputDirectory, name));
    if (files.length === 0) throw new Error("FFmpeg没有生成音频分段");
    return files;
  }
}
