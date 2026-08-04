import process from "node:process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DiagnosisFlow, OpenAiCompatibleProvider } from "@hongtai/ai";
import { IngestPipeline } from "@hongtai/core";
import {
  FileDiagnosisRepository,
  FileArtifactStore,
  FfmpegMediaTools,
  OpenAiMediaClient,
  SharpImagePreprocessor,
  NodeHttpClient,
  NodeMediaDownloader,
  TerminalProgressReporter,
  createDiagnosisHarnessServer,
  loadLocalEnvironment,
  readNodeRuntimeConfig,
} from "@hongtai/node-runtime";
import { platformRegistry } from "@hongtai/platforms";
import { parseDiagnosisServeOptions } from "./ai-command-options";

const HELP = `宏泰 AI 智能体 CLI

用法：
  pnpm cli --help
  pnpm cli ingest <分享文字或公开链接> [--output <目录>] [--max-duration <秒>]
  pnpm cli diagnosis serve [--port <端口>]

支持：
  抖音、小红书、B站公开单条作品；小红书同时支持视频和图文笔记

示例：
  pnpm cli ingest "https://www.bilibili.com/video/BVxxxxxxxxxx"
  pnpm cli ingest "https://v.douyin.com/xxxxxx/" --output D:\\HongTaiOutput
  pnpm cli ingest "复制打开小红书 xhslink.cn/o/xxxxxx 这篇笔记等你来看"

说明：
  可以直接粘贴平台生成的整段分享文字。未配置AI时，视频文稿会降级使用平台描述；图文笔记不需要AI。
`;

function safeTerminalText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/data:(image|audio)\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, "data:$1/[REDACTED];base64,[REDACTED]");
}

interface CliOptions {
  readonly input: string;
  readonly outputDirectory?: string;
  readonly maxDurationSeconds?: number;
}

function parseIngestOptions(args: readonly string[]): CliOptions {
  const input = args[0];
  if (!input) throw new Error("缺少分享内容或作品链接");
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
  return { input, outputDirectory, maxDurationSeconds };
}

async function runIngest(args: readonly string[]): Promise<void> {
  const options = parseIngestOptions(args);
  const projectRoot = resolve(import.meta.dirname, "../../..");
  loadLocalEnvironment(resolve(projectRoot, ".env"));
  const config = readNodeRuntimeConfig();
  const ai = config.ai ? new OpenAiMediaClient(config.ai) : undefined;
  const workspaceDirectory = isAbsolute(config.workspaceDirectory)
    ? config.workspaceDirectory
    : resolve(projectRoot, config.workspaceDirectory);

  console.log(`运行模式：公开单条作品，已注册平台=${platformRegistry.size}个，AI转写=${ai ? "已配置" : "未配置"}`);
  const pipeline = new IngestPipeline({
    adapters: platformRegistry.all,
    http: new NodeHttpClient(),
    downloader: new NodeMediaDownloader(),
    mediaTools: new FfmpegMediaTools(),
    transcriber: ai,
    rewriter: ai,
    store: new FileArtifactStore(workspaceDirectory),
    reporter: new TerminalProgressReporter(),
  });

  const result = await pipeline.run({
    input: options.input,
    outputDirectory: options.outputDirectory,
    maxDurationSeconds: options.maxDurationSeconds ?? config.maxDurationSeconds,
  });

  console.log("\n任务结果");
  console.log(`  任务ID：${result.taskId}`);
  console.log(`  状态：${result.status}`);
  if (result.platform) console.log(`  平台：${result.platform}`);
  if (result.contentType) console.log(`  内容类型：${result.contentType}`);
  if (result.speechStatus) console.log(`  口播状态：${result.speechStatus}`);
  if (result.videoPath) console.log(`  视频：${result.videoPath}`);
  if (result.transcriptPath) console.log(`  原始文稿：${result.transcriptPath}`);
  if (result.draftPath) console.log(`  整理稿：${result.draftPath}`);
  if (result.contentTextPath) console.log(`  图文正文：${result.contentTextPath}`);
  const firstImagePath = result.imagePaths?.[0];
  if (firstImagePath) console.log(`  图片：${result.imagePaths?.length ?? 0}张，目录=${dirname(firstImagePath)}`);
  for (const issue of result.issues) {
    const line = `  ${issue.severity === "error" ? "错误" : "提示"}[${issue.code}]：${issue.userMessage}`;
    if (issue.severity === "error") console.error(line);
    else console.log(line);
  }

  const hasPrimaryArtifacts = result.contentType === "image_text"
    ? Boolean(result.contentTextPath || result.imagePaths?.length)
    : Boolean(result.videoPath && (result.transcriptPath || result.speechStatus === "no_speech"));
  if (!hasPrimaryArtifacts) process.exitCode = 1;
}

async function runDiagnosisServe(args: readonly string[]): Promise<void> {
  const options = parseDiagnosisServeOptions(args);
  const projectRoot = resolve(import.meta.dirname, "../../..");
  loadLocalEnvironment(resolve(projectRoot, ".env"));
  const config = readNodeRuntimeConfig();
  if (!config.ai) throw new Error("未配置AI连接，请先填写.env中的Base URL、API Key、文本模型和视觉模型");
  const workspaceDirectory = isAbsolute(config.workspaceDirectory)
    ? config.workspaceDirectory
    : resolve(projectRoot, config.workspaceDirectory);
  const diagnosisRoot = join(workspaceDirectory, "ai", "diagnosis");
  const repository = new FileDiagnosisRepository(diagnosisRoot);
  const provider = new OpenAiCompatibleProvider(config.ai);
  const flow = new DiagnosisFlow({
    provider,
    repository,
    contextWindowTokens: config.ai.contextWindowTokens,
    onEvent: (event) => {
      if (event.type === "reasoning_delta") process.stdout.write(`[思考] ${safeTerminalText(event.delta)}\n`);
      if (event.type === "content_delta") process.stdout.write(`[输出] ${safeTerminalText(event.delta)}\n`);
      if (event.type === "usage") console.log(`[用量] 输入=${event.promptTokens ?? "未知"}，输出=${event.completionTokens ?? "未知"}`);
    },
  });
  const server = createDiagnosisHarnessServer({
    flow,
    preprocessor: new SharpImagePreprocessor(),
    onSessionCreated: (sessionId) => console.log(`会话已保存：${join(diagnosisRoot, sessionId)}`),
  });
  server.listen(options.port, "127.0.0.1", () => {
    console.log(`本地图片观察测试入口：http://127.0.0.1:${options.port}`);
    console.log("仅监听本机回环地址，按Ctrl+C停止。详细JSON、reasoning和日志保存在workspace。 ");
  });
}

async function main(args: readonly string[]): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  if (command === "diagnosis" && rest[0] === "serve") {
    await runDiagnosisServe(rest.slice(1));
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
