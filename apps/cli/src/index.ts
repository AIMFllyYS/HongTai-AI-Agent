import process from "node:process";
import { isAbsolute, resolve } from "node:path";
import { IngestPipeline } from "@hongtai/core";
import {
  FileArtifactStore,
  FfmpegMediaTools,
  MimoClient,
  NodeHttpClient,
  NodeMediaDownloader,
  TerminalProgressReporter,
  loadLocalEnvironment,
  readNodeRuntimeConfig,
} from "@hongtai/node-runtime";
import { platformRegistry } from "@hongtai/platforms";

const HELP = `宏泰 AI 智能体 CLI

用法：
  pnpm cli --help
  pnpm cli ingest <公开视频链接> [--output <目录>] [--max-duration <秒>]

支持：
  抖音、小红书、B站公开单条视频链接

示例：
  pnpm cli ingest "https://www.bilibili.com/video/BVxxxxxxxxxx"
  pnpm cli ingest "https://v.douyin.com/xxxxxx/" --output D:\\HongTaiOutput

说明：
  未配置 HONGTAI_AI_API_KEY 时仍会尝试解析和下载视频，文稿仅能降级使用平台描述。
`;

interface CliOptions {
  readonly url: string;
  readonly outputDirectory?: string;
  readonly maxDurationSeconds?: number;
}

function parseIngestOptions(args: readonly string[]): CliOptions {
  const url = args[0];
  if (!url) throw new Error("缺少视频链接");
  let outputDirectory: string | undefined;
  let maxDurationSeconds: number | undefined;

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--output") {
      outputDirectory = args[index + 1];
      if (!outputDirectory) throw new Error("--output缺少目录参数");
      index += 1;
      continue;
    }
    if (argument === "--max-duration") {
      maxDurationSeconds = Number(args[index + 1]);
      if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) {
        throw new Error("--max-duration必须是大于0的秒数");
      }
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }
  return { url, outputDirectory, maxDurationSeconds };
}

async function runIngest(args: readonly string[]): Promise<void> {
  const options = parseIngestOptions(args);
  const projectRoot = resolve(import.meta.dirname, "../../..");
  loadLocalEnvironment(resolve(projectRoot, ".env"));
  const config = readNodeRuntimeConfig();
  const mimo = config.ai ? new MimoClient(config.ai) : undefined;
  const workspaceDirectory = isAbsolute(config.workspaceDirectory)
    ? config.workspaceDirectory
    : resolve(projectRoot, config.workspaceDirectory);

  console.log(`运行模式：公开链接，已注册平台=${platformRegistry.size}个，AI转写=${mimo ? "已配置" : "未配置"}`);
  const pipeline = new IngestPipeline({
    adapters: platformRegistry.all,
    http: new NodeHttpClient(),
    downloader: new NodeMediaDownloader(),
    mediaTools: new FfmpegMediaTools(),
    transcriber: mimo,
    rewriter: mimo,
    store: new FileArtifactStore(workspaceDirectory),
    reporter: new TerminalProgressReporter(),
  });

  const result = await pipeline.run({
    url: options.url,
    outputDirectory: options.outputDirectory,
    maxDurationSeconds: options.maxDurationSeconds ?? config.maxDurationSeconds,
  });

  console.log("\n任务结果");
  console.log(`  任务ID：${result.taskId}`);
  console.log(`  状态：${result.status}`);
  if (result.platform) console.log(`  平台：${result.platform}`);
  if (result.videoPath) console.log(`  视频：${result.videoPath}`);
  if (result.transcriptPath) console.log(`  原始文稿：${result.transcriptPath}`);
  if (result.draftPath) console.log(`  整理稿：${result.draftPath}`);
  for (const warning of result.warnings) console.log(`  提示：${warning}`);
  if (result.error) console.error(`  错误：${result.error}`);

  if (!result.videoPath || !result.transcriptPath) process.exitCode = 1;
}

async function main(args: readonly string[]): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  if (command !== "ingest") {
    console.error(`未知命令：${command}`);
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  await runIngest(rest);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`CLI启动失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
