import { PIPELINE_STAGES } from "@hongtai/core";
import { NODE_RUNTIME_STATUS } from "@hongtai/node-runtime";
import { platformRegistry } from "@hongtai/platforms";

const HELP = `宏泰 AI 智能体 CLI（工程骨架）

用法：
  pnpm cli --help
  pnpm cli ingest <视频链接>

说明：
  当前只初始化工程边界，不执行真实的平台解析、下载或转写。
`;

function main(args: readonly string[]): void {
  const [command, url] = args;

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

  if (!url) {
    console.error("缺少视频链接。用法：pnpm cli ingest <视频链接>");
    process.exitCode = 1;
    return;
  }

  console.log(`已接收链接：${url}`);
  console.log(`已注册平台适配器：${platformRegistry.size}`);
  console.log(`Node运行时：${NODE_RUNTIME_STATUS}`);
  console.log("预定处理阶段：");
  for (const [index, stage] of PIPELINE_STAGES.entries()) {
    console.log(`  ${index + 1}. ${stage}`);
  }
  console.log("当前为工程骨架，尚未执行真实处理。");
}

main(process.argv.slice(2));

