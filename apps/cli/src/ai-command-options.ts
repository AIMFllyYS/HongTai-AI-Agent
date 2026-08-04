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
