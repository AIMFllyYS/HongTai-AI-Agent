import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { TaskError, type ErrorCode, type MediaTools } from "@hongtai/core";
import { replaceDownloadedFile } from "../download/node-downloader";

const DEFAULT_TIMEOUT_MS = 3_600_000;
const DEFAULT_KILL_GRACE_MS = 5_000;

export type FfmpegSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface FfmpegMediaToolsOptions {
  readonly timeoutMs?: number;
  readonly killGraceMs?: number;
  readonly spawn?: FfmpegSpawn;
  readonly replaceFile?: (temporary: string, destination: string) => Promise<void>;
  readonly copyFile?: (source: string, destination: string) => Promise<void>;
}

function mediaToolError(error: unknown, code: ErrorCode, message: string): TaskError {
  return error instanceof TaskError ? error : new TaskError({ code, message, action: "retry", cause: error });
}

function outputPartPath(outputPath: string): string {
  return join(dirname(outputPath), `.${basename(outputPath)}.${randomUUID()}.part`);
}

function killChild(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    // 进程可能已经退出
  }
}

function run(
  command: string,
  args: readonly string[],
  options: { timeoutMs: number; killGraceMs: number; spawn: FfmpegSpawn },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = options.spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const finish = (error?: Error, result?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (error) reject(error);
      else resolve(result ?? "");
    };

    const timeoutTimer = setTimeout(() => {
      killChild(child, "SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) killChild(child, "SIGKILL");
      }, options.killGraceMs);
      finish(new Error(`${command}执行超时（${options.timeoutMs}ms）`));
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => finish(error instanceof Error ? error : new Error(String(error))));
    child.once("close", (code) => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (code === 0) finish(undefined, Buffer.concat(stdout).toString("utf8"));
      else finish(new Error(`${command}执行失败（${code ?? "unknown"}）：${Buffer.concat(stderr).toString("utf8").slice(-1_000)}`));
    });
  });
}

async function writeViaTemporary(
  outputPath: string,
  produce: (temporary: string) => Promise<void>,
): Promise<void> {
  const temporary = outputPartPath(outputPath);
  try {
    await produce(temporary);
    await replaceDownloadedFile(temporary, outputPath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export class FfmpegMediaTools implements MediaTools {
  readonly #timeoutMs: number;
  readonly #killGraceMs: number;
  readonly #spawn: FfmpegSpawn;
  readonly #replaceFile: (temporary: string, destination: string) => Promise<void>;
  readonly #copyFile: (source: string, destination: string) => Promise<void>;

  constructor(options: FfmpegMediaToolsOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.#spawn = options.spawn ?? spawn;
    this.#replaceFile = options.replaceFile ?? replaceDownloadedFile;
    this.#copyFile = options.copyFile ?? copyFile;
  }

  #run(command: string, args: readonly string[]): Promise<string> {
    return run(command, args, {
      timeoutMs: this.#timeoutMs,
      killGraceMs: this.#killGraceMs,
      spawn: this.#spawn,
    });
  }

  async merge(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
    try {
      await writeViaTemporary(outputPath, (temporary) => this.#run("ffmpeg", [
        "-y", "-i", videoPath, "-i", audioPath, "-c", "copy", "-movflags", "+faststart", temporary,
      ]).then(() => undefined));
    } catch {
      try {
        await writeViaTemporary(outputPath, (temporary) => this.#run("ffmpeg", [
          "-y", "-i", videoPath, "-i", audioPath, "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", temporary,
        ]).then(() => undefined));
      } catch (error) {
        throw mediaToolError(error, "MEDIA_MERGE_FAILED", "音视频合并失败");
      }
    }
  }

  async probeDuration(mediaPath: string): Promise<number> {
    let output: string;
    try {
      output = await this.#run("ffprobe", [
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
      await writeViaTemporary(audioPath, (temporary) => this.#run("ffmpeg", [
        "-y", "-i", videoPath,
        "-vn", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
        "-c:a", "pcm_s16le", temporary,
      ]).then(() => undefined));
    } catch (error) {
      throw mediaToolError(error, "MEDIA_PROBE_FAILED", "视频音频提取失败");
    }
  }

  async splitAudio(audioPath: string, outputDirectory: string, segmentSeconds: number): Promise<readonly string[]> {
    await mkdir(outputDirectory, { recursive: true });
    const temporaryDirectory = join(outputDirectory, `.segments-${randomUUID()}`);
    const backupDirectory = join(outputDirectory, `.segments-backup-${randomUUID()}`);
    await mkdir(temporaryDirectory, { recursive: true });
    let retainBackup = false;
    try {
      await this.#run("ffmpeg", [
        "-y", "-i", audioPath,
        "-f", "segment", "-segment_time", String(segmentSeconds), "-reset_timestamps", "1",
        "-c:a", "pcm_s16le", join(temporaryDirectory, "segment-%04d.wav"),
      ]);
      const names = (await readdir(temporaryDirectory))
        .filter((name) => /^segment-\d+\.wav$/i.test(name))
        .sort();
      if (names.length === 0) throw new TaskError({ code: "MEDIA_PROBE_FAILED", message: "FFmpeg没有生成音频分段", action: "retry" });
      await mkdir(backupDirectory, { recursive: true });
      const backedUp = new Set<string>();
      for (const name of names) {
        try {
          await this.#copyFile(join(outputDirectory, name), join(backupDirectory, name));
          backedUp.add(name);
        } catch (error) {
          if ((error as { code?: string }).code !== "ENOENT") throw error;
        }
      }
      const replaced: string[] = [];
      try {
        const files: string[] = [];
        for (const name of names) {
          const destination = join(outputDirectory, name);
          await this.#replaceFile(join(temporaryDirectory, name), destination);
          replaced.push(name);
          files.push(destination);
        }
        return files;
      } catch (error) {
        try {
          for (const name of replaced) {
            if (!backedUp.has(name)) continue;
            await this.#copyFile(join(backupDirectory, name), join(outputDirectory, name));
          }
        } catch (restoreError) {
          retainBackup = true;
          if (restoreError instanceof Error) restoreError.cause = error;
          throw restoreError;
        }
        throw error;
      }
    } catch (error) {
      throw mediaToolError(error, "MEDIA_PROBE_FAILED", "音频切片失败");
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
      if (!retainBackup) await rm(backupDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
