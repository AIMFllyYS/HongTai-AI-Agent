const TOKEN = typeof __HONGTAI_BROWSER_IO_TOKEN__ === "string" ? __HONGTAI_BROWSER_IO_TOKEN__ : "";

export function browserIoEnabled(): boolean {
  return Boolean(TOKEN);
}

export function nativeFileUri(area: string, id: string, relativePath: string): string {
  return `file:///hongtai-browser-io/${area}/${id}/${relativePath}`;
}

export function displayFileSrc(uri: string): string {
  const origin = globalThis.location?.origin;
  if (!origin) throw Object.assign(new Error("浏览器本地文件服务不可用"), { code: "ERR_APP_RUNTIME_UNAVAILABLE" });
  return `${origin}/__hongtai-io/file?uri=${encodeURIComponent(uri)}&t=${encodeURIComponent(TOKEN)}`;
}

export async function browserIoRpc<T>(op: string, payload: unknown = {}): Promise<T> {
  if (!TOKEN) throw Object.assign(new Error("浏览器本地 I/O 未启用"), { code: "ERR_APP_RUNTIME_UNAVAILABLE" });
  const response = await fetch("/__hongtai-io/rpc", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hongtai-browser-io": TOKEN,
    },
    body: JSON.stringify({ op, payload }),
  });
  const result = await readJson(response);
  if (!response.ok) {
    throw Object.assign(new Error(typeof result.message === "string" ? result.message : "浏览器本地 I/O 失败"), {
      code: typeof result.code === "string" ? result.code : "ERR_APP_RUNTIME_UNAVAILABLE",
    });
  }
  return result as T;
}

export async function browserIoWriteBinary(options: {
  readonly uri: string;
  readonly mimeType?: string;
  readonly body: Blob | ArrayBuffer;
}): Promise<{ readonly uri: string; readonly sizeBytes: number; readonly mimeType?: string }> {
  if (!TOKEN) throw Object.assign(new Error("浏览器本地 I/O 未启用"), { code: "ERR_APP_RUNTIME_UNAVAILABLE" });
  const response = await fetch("/__hongtai-io/write-binary", {
    method: "POST",
    headers: {
      "x-hongtai-browser-io": TOKEN,
      "x-hongtai-uri": options.uri,
      ...(options.mimeType ? { "x-hongtai-mime": options.mimeType } : {}),
    },
    body: options.body,
  });
  const result = await readJson(response);
  if (!response.ok) {
    throw Object.assign(new Error(typeof result.message === "string" ? result.message : "文件写入失败"), {
      code: typeof result.code === "string" ? result.code : "ERR_PRIVATE_FILE_IMPORT_FAILED",
    });
  }
  return result as { readonly uri: string; readonly sizeBytes: number; readonly mimeType?: string };
}

export async function browserIoStream(op: string, payload: unknown, onEvent: (event: Readonly<Record<string, unknown>>) => void): Promise<void> {
  if (!TOKEN) throw Object.assign(new Error("浏览器本地 I/O 未启用"), { code: "ERR_APP_RUNTIME_UNAVAILABLE" });
  const response = await fetch("/__hongtai-io/stream", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hongtai-browser-io": TOKEN,
    },
    body: JSON.stringify({ op, payload }),
  });
  if (!response.ok || !response.body) {
    const result = await readJson(response);
    throw Object.assign(new Error(typeof result.message === "string" ? result.message : "浏览器本地流失败"), {
      code: typeof result.code === "string" ? result.code : "ERR_APP_RUNTIME_UNAVAILABLE",
    });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      onEvent(JSON.parse(trimmed) as Readonly<Record<string, unknown>>);
    }
    if (done) break;
  }
}

async function readJson(response: Response): Promise<Readonly<Record<string, unknown>>> {
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === "object" && parsed !== null ? parsed as Readonly<Record<string, unknown>> : {};
  } catch {
    return {};
  }
}
