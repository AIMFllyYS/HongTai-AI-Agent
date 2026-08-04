export function parseDiagnosisServeOptions(args: readonly string[]): { readonly port: number } {
  let port = 4_317;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--port") {
      port = Number(args[index + 1]);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("--port必须是1到65535之间的端口");
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }
  return { port };
}

export function parseContentAnalysisOptions(args: readonly string[]): { readonly taskId: string } {
  if (args.length !== 1) throw new Error("analyze-content需要且只接受一个任务ID参数");
  const taskId = args[0];
  if (!taskId || !/^[a-zA-Z0-9-]+$/.test(taskId)) throw new Error("任务ID格式无效");
  return { taskId };
}
