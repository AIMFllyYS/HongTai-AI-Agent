import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { isIP } from "node:net";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile, copyFile, appendFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const FETCH_HEADERS = new Set(["user-agent", "referer", "accept", "accept-language", "origin", "content-type"]);
const DOWNLOAD_HEADERS = new Set(["accept", "accept-language", "referer", "user-agent"]);
const FORBIDDEN_AI_HEADERS = new Set([
  "authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "api-key", "api_key",
  "x-auth-token", "x-access-token", "host", "content-length", "connection", "transfer-encoding", "upgrade",
]);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 1_073_741_824;
const MAX_JSON_REQUEST_BYTES = 24 * 1024 * 1024;
const PRIVATE_PREFIX = "file:///hongtai-browser-io/";

const token = randomBytes(24).toString("hex");
const rootDir = join(fileURLToPath(new URL(".", import.meta.url)), ".tmp", "hongtai-browser-io");
let volatileSecrets: Record<string, string> = {};
const storageEntries = new Map<string, { readonly file: string; readonly deletable: boolean; readonly guardFile?: string }>();

type Json = Record<string, unknown>;

function temporaryPath(file: string, suffix: string): string {
  return `${file}.${randomBytes(12).toString("hex")}.${suffix}`;
}

async function replaceFile(temporary: string, destination: string): Promise<void> {
  try {
    await rename(temporary, destination);
    return;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "EEXIST" && code !== "EPERM") throw error;
  }
  const backup = temporaryPath(destination, "bak");
  await rename(destination, backup);
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rename(backup, destination).catch(() => undefined);
    throw error;
  }
  await rm(backup, { force: true });
}

async function writeTextAtomically(file: string, value: string): Promise<void> {
  const temporary = temporaryPath(file, "tmp");
  try {
    await writeFile(temporary, value, "utf8");
    await replaceFile(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function copyFileAtomically(source: string, destination: string): Promise<void> {
  const temporary = temporaryPath(destination, "tmp");
  try {
    await copyFile(source, temporary);
    await replaceFile(temporary, destination);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export function hongtaiBrowserIo(): Plugin {
  const seeded = seedFromLocalEnv().catch(() => undefined);
  return {
    name: "hongtai-browser-io",
    config(_config, env) {
      return {
        define: {
          __HONGTAI_BROWSER_IO_TOKEN__: JSON.stringify(env.command === "serve" ? token : ""),
        },
      };
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void seeded.then(() => handle(req, res)).then((handled) => {
          if (!handled) next();
        }).catch(() => {
          writeJson(res, 500, { code: "ERR_APP_RUNTIME_UNAVAILABLE", message: "浏览器本地 I/O 失败" });
        });
      });
    },
  };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/__hongtai-io/")) return false;
  if (req.method === "GET" && url.pathname === "/__hongtai-io/file") {
    await serveFile(url, res);
    return true;
  }
  if (!authorized(req, url)) {
    writeJson(res, 403, { code: "ERR_APP_RUNTIME_UNAVAILABLE", message: "浏览器本地 I/O 未授权" });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/__hongtai-io/write-binary") {
    await writeBinary(req, res);
    return true;
  }
  if (req.method === "POST" && url.pathname === "/__hongtai-io/rpc") {
    const body = await readJsonBody(req);
    try {
      writeJson(res, 200, await dispatch(String(body.op ?? ""), body.payload));
    } catch (error) {
      writeJson(res, 400, failure(error));
    }
    return true;
  }
  if (req.method === "POST" && url.pathname === "/__hongtai-io/stream") {
    const body = await readJsonBody(req);
    res.statusCode = 200;
    res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders();
    try {
      await dispatchStream(String(body.op ?? ""), body.payload, (event) => {
        res.write(`${JSON.stringify(event)}\n`);
      });
    } catch (error) {
      res.write(`${JSON.stringify({ type: "failed", ...failure(error) })}\n`);
    }
    res.end();
    return true;
  }
  writeJson(res, 404, { code: "ERR_APP_RUNTIME_UNAVAILABLE", message: "未知的浏览器本地 I/O" });
  return true;
}

function authorized(req: IncomingMessage, url: URL): boolean {
  return req.headers["x-hongtai-browser-io"] === token || url.searchParams.get("t") === token;
}

async function dispatch(op: string, payload: unknown): Promise<Json> {
  const input = asRecord(payload);
  const id = entityId(input);
  switch (op) {
    case "secret.write":
      await saveSecrets({ ...(await loadSecrets()), [stringValue(input.slot)]: stringValue(input.value) });
      return {};
    case "secret.has":
      return { exists: Boolean((await loadSecrets())[stringValue(input.slot)]) };
    case "secret.remove": {
      const secrets = await loadSecrets();
      delete secrets[stringValue(input.slot)];
      await saveSecrets(secrets);
      return {};
    }
    case "localData.getProfile":
      return { profile: (await loadState()).profile };
    case "localData.saveProfile":
      await saveState({ ...(await loadState()), profile: input });
      return {};
    case "localData.getAiConnection":
      return { connection: (await loadState()).connection };
    case "localData.saveAiConnection":
      await saveState({ ...(await loadState()), connection: input });
      return {};
    case "localData.compareAndSetAiProbeResults": {
      const state = await loadState();
      const connection = asRecord(state.connection);
      if (!connection || Number(connection.updatedAtEpochMs) !== Number(input.expectedUpdatedAtEpochMs)) return { applied: false };
      await saveState({
        ...state,
        connection: {
          ...connection,
          probeResultsJson: stringValue(input.probeResultsJson),
          updatedAtEpochMs: Number(input.updatedAtEpochMs),
        },
      });
      return { applied: true };
    }
    case "files.ensure":
      await mkdir(areaDir(stringValue(input.area), id), { recursive: true });
      return {};
    case "files.writeText":
      await writeTextFile(stringValue(input.area), id, stringValue(input.relativePath), stringValue(input.value), input.replace !== false);
      return {};
    case "files.appendText":
      await writeTextFile(stringValue(input.area), id, stringValue(input.relativePath), stringValue(input.value), false);
      return {};
    case "files.readText": {
      try {
        return { value: await readFile(diskPath(stringValue(input.area), id, stringValue(input.relativePath)), "utf8") };
      } catch {
        return {};
      }
    }
    case "files.exists":
      return { exists: await exists(diskPath(stringValue(input.area), id, stringValue(input.relativePath))) };
    case "files.listIds":
      return { ids: await listIds(stringValue(input.area)) };
    case "files.delete":
      await rm(areaDir(stringValue(input.area), id), { recursive: true, force: true });
      return {};
    case "files.deleteFile":
      await rm(diskPath(stringValue(input.area), id, stringValue(input.relativePath)), { force: true });
      return {};
    case "files.getUri":
      return fileInfo(stringValue(input.area), id, stringValue(input.relativePath));
    case "files.copyPrivateFile":
      await copyUri(stringValue(input.sourceUri), diskPath(stringValue(input.area), id, stringValue(input.relativePath)));
      return {};
    case "files.copyTo": {
      await copyUri(stringValue(input.sourceUri), diskPath(stringValue(input.area), id, stringValue(input.relativePath)));
      return await fileInfo(stringValue(input.area), id, stringValue(input.relativePath));
    }
    case "files.copyFromUri": {
      const id = "imported";
      const relativePath = `copy/${createHash("sha256").update(stringValue(input.sourceUri)).digest("hex").slice(0, 16)}`;
      await copyUri(stringValue(input.sourceUri), diskPath("profile", id, relativePath));
      return fileInfo("profile", id, relativePath);
    }
    case "storage.inspect":
      return await inspectBrowserStorage();
    case "storage.deleteItem":
      await deleteBrowserStorageItem(stringValue(input.itemId));
      return {};
    case "http.fetchText":
      return await fetchText(input);
    case "http.probeTts":
      throw Object.assign(new Error("浏览器端测未接入云端配音"), { code: "ERR_TTS_UNAVAILABLE" });
    case "media.remux":
      return await remux(input);
    case "media.probe":
      return { durationMs: Math.round(await probeSeconds(uriToDisk(stringValue(input.uri))) * 1_000) };
    case "media.extractPcmWav":
      return await extractWav(input);
    case "media.segmentPcmWav":
      return await segmentWav(input);
    default:
      throw Object.assign(new Error("未知的浏览器本地操作"), { code: "ERR_APP_RUNTIME_UNAVAILABLE" });
  }
}

async function dispatchStream(op: string, payload: unknown, emit: (event: Json) => void): Promise<void> {
  const input = asRecord(payload);
  if (op === "http.download") {
    await download(input, emit);
    return;
  }
  if (op === "http.aiRequest") {
    await aiRequest(input, emit);
    return;
  }
  throw Object.assign(new Error("未知的浏览器本地流"), { code: "ERR_APP_RUNTIME_UNAVAILABLE" });
}

async function fetchText(input: Json): Promise<Json> {
  const method = stringValue(input.method) === "POST" ? "POST" : "GET";
  const target = publicHttps(stringValue(input.url));
  const headers = sanitizeHeaders(asRecord(input.headers), FETCH_HEADERS, 8);
  const maxRedirects = clamp(Number(input.maxRedirects ?? 0), 0, 5);
  const timeoutMs = clamp(Number(input.timeoutMs ?? 30_000), 1_000, 120_000);
  let current = target;
  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const response = await fetch(current, {
        method,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        body: method === "POST" ? stringValue(input.body) : undefined,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw Object.assign(new Error("平台跳转响应缺少目标地址"), { code: "ERR_LINK_REDIRECT_INVALID" });
        const next = publicHttps(new URL(location, current).toString());
        if (maxRedirects === 0) {
          return { finalUrl: next, status: response.status, headers: { location: next }, body: "" };
        }
        current = next;
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_TEXT_BYTES) throw Object.assign(new Error("页面响应超出安全解析限制"), { code: "ERR_LINK_RESPONSE_TOO_LARGE" });
      return {
        finalUrl: current,
        status: response.status,
        headers: publicResponseHeaders(response.headers),
        body: buffer.toString("utf8"),
      };
    }
  } catch (error) {
    if (isCodedError(error)) throw error;
    throw codedError(classifyLinkError(error), "页面请求失败");
  }
  throw Object.assign(new Error("链接跳转次数过多"), { code: "ERR_LINK_REDIRECT_LIMIT" });
}

async function download(input: Json, emit: (event: Json) => void): Promise<void> {
  const taskId = stringValue(input.taskId);
  const artifact = asRecord(input.artifact);
  const relativePath = artifactPath(artifact);
  const destination = diskPath("tasks", taskId, relativePath);
  const temporary = temporaryPath(destination, "part");
  const headers = sanitizeHeaders(asRecord(input.headers), DOWNLOAD_HEADERS, 4);
  let current = publicHttps(stringValue(input.sourceUrl));
  try {
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(current, { headers: { ...headers, "accept-encoding": "identity" }, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw Object.assign(new Error("媒体跳转地址无效"), { code: "ERR_LINK_REDIRECT_INVALID" });
      current = publicHttps(new URL(location, current).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300 || !response.body) {
      throw Object.assign(new Error("媒体下载失败"), { code: "ERR_MEDIA_DOWNLOAD_FAILED" });
    }
    await mkdir(dirname(destination), { recursive: true });
    const total = Number(response.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(total) && total > MAX_DOWNLOAD_BYTES) {
      throw Object.assign(new Error("媒体文件超过本地下载限制"), { code: "ERR_STORAGE_SPACE_INSUFFICIENT" });
    }
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim();
    const file = createWriteStream(temporary);
    const reader = response.body.getReader();
    let written = 0;
    let completed = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        written += value.byteLength;
        if (written > MAX_DOWNLOAD_BYTES) throw Object.assign(new Error("媒体文件超过本地下载限制"), { code: "ERR_STORAGE_SPACE_INSUFFICIENT" });
        await new Promise<void>((resolve, reject) => file.write(value, (error) => error ? reject(error) : resolve()));
        emit({ type: "progress", downloadedBytes: written, ...(Number.isFinite(total) ? { totalBytes: total, progress: written / total } : {}) });
      }
      completed = true;
    } finally {
      if (!completed) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      await new Promise<void>((resolve) => file.end(() => resolve()));
    }
    await replaceFile(temporary, destination);
    const uri = `${PRIVATE_PREFIX}tasks/${taskId}/${relativePath}`;
    emit({ type: "completed", uri, sizeBytes: written, ...(mimeType ? { mimeType } : {}) });
    return;
  }
  throw Object.assign(new Error("媒体跳转次数过多"), { code: "ERR_LINK_REDIRECT_LIMIT" });
  } catch (error) {
    if (isCodedError(error)) throw error;
    throw codedError(classifyLinkError(error, "ERR_MEDIA_DOWNLOAD_FAILED"), "媒体下载失败");
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function inspectBrowserStorage(): Promise<Json> {
  storageEntries.clear();
  const files = await collectFiles(rootDir);
  const items: Json[] = [];
  for (const file of files) {
    const relativePath = relative(rootDir, file).replaceAll("\\", "/");
    const classification = await classifyBrowserStorageFile(relativePath);
    const id = `browser-storage-${randomBytes(12).toString("hex")}`;
    storageEntries.set(id, { file, deletable: classification.deletable, ...(classification.guardFile ? { guardFile: classification.guardFile } : {}) });
    items.push({
      id,
      area: classification.area,
      kind: classification.kind,
      role: classification.role,
      byteLength: (await stat(file)).size,
      deletable: classification.deletable,
      ...(classification.protectionCode ? { protectionCode: classification.protectionCode } : {}),
    });
  }
  return { schemaVersion: "native-storage.v1", generatedAtEpochMs: Date.now(), items };
}

async function deleteBrowserStorageItem(itemId: string): Promise<void> {
  const entry = storageEntries.get(itemId);
  if (!entry) throw codedError("ERR_STORAGE_ITEM_EXPIRED", "存储清单已更新，请先重新读取");
  if (!entry.deletable) throw codedError("ERR_STORAGE_ITEM_PROTECTED", "数据文件不能从这里删除");
  if (entry.guardFile && await exists(entry.guardFile)) {
    const status = stringValue(asRecord(JSON.parse(await readFile(entry.guardFile, "utf8"))).status);
    if (["queued", "running", "planning", "rendering"].includes(status)) {
      throw codedError("ERR_STORAGE_ITEM_PROTECTED", "进行中的任务文件不能删除");
    }
  }
  await rm(entry.file, { force: true });
  storageEntries.delete(itemId);
}

async function collectFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  let children;
  try {
    children = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const child of children) {
    const path = join(directory, child.name);
    if (child.isDirectory()) files.push(...await collectFiles(path));
    else if (child.isFile()) files.push(path);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function classifyBrowserStorageFile(relativePath: string): Promise<{
  readonly area: "tasks" | "observations" | "productions" | "templates" | "cache" | "app-data";
  readonly kind: "video" | "image" | "audio" | "document" | "temporary" | "other";
  readonly role: "user-video" | "parsed-video" | "parsed-audio" | "parsed-image" | "observation-image" | "production-asset" | "production-output" | "derived-frame" | "template-media" | "cache" | "app-data" | "protected-other";
  readonly deletable: boolean;
  readonly protectionCode?: "data" | "active" | "unknown";
  readonly guardFile?: string;
}> {
  const normalized = relativePath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  const first = parts[0] ?? "";
  const lower = normalized.toLowerCase();
  const extension = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  const kind = storageKindForExtension(extension, lower);
  if (first === "cache" || lower.includes("/cache/") || lower.includes("app_webview")) {
    return { area: "cache", kind: kind === "other" ? "temporary" : kind, role: "cache", deletable: true };
  }
  if (extension === "part" || extension === "tmp") {
    return { area: "cache", kind: "temporary", role: "cache", deletable: true };
  }
  if (first === "tasks" || first === "observations" || first === "productions" || first === "templates") {
    const area = first;
    const dataFile = ["json", "jsonl", "txt"].includes(extension);
    const identifier = parts[1] ?? "";
    const guardFile = area === "tasks" ? join(rootDir, area, identifier, "task.json") : area === "productions" ? join(rootDir, area, identifier, "project.json") : undefined;
    if (dataFile) {
      return { area, kind: "document", role: "app-data", deletable: false, protectionCode: "data" };
    }
    const sourceKind = area === "tasks" && guardFile ? await browserTaskSourceKind(guardFile) : "";
    const role = storageMediaRole(area, lower, sourceKind);
    const active = Boolean(guardFile && await isBrowserStorageBusy(guardFile));
    return { area, kind, role, deletable: !active && kind !== "other", ...(active ? { protectionCode: "active" as const } : kind === "other" ? { protectionCode: "unknown" as const } : {}), ...(guardFile ? { guardFile } : {}) };
  }
  return { area: "app-data", kind: dataFileKind(extension), role: "app-data", deletable: false, protectionCode: "unknown" };
}

async function isBrowserStorageBusy(statusFile: string): Promise<boolean> {
  if (!await exists(statusFile)) return false;
  try {
    const status = stringValue(asRecord(JSON.parse(await readFile(statusFile, "utf8"))).status);
    return ["queued", "running", "planning", "rendering"].includes(status);
  } catch {
    return false;
  }
}

async function browserTaskSourceKind(statusFile: string): Promise<string> {
  try {
    return stringValue(asRecord(JSON.parse(await readFile(statusFile, "utf8"))).sourceKind);
  } catch {
    return "";
  }
}

function storageKindForExtension(extension: string, path: string): "video" | "image" | "audio" | "document" | "temporary" | "other" {
  if (["mp4", "mov", "m4v", "webm"].includes(extension)) return "video";
  if (["jpg", "jpeg", "png", "webp", "heic", "heif", "bin"].includes(extension) && (path.includes("image") || path.includes("cover") || extension !== "bin")) return "image";
  if (["wav", "mp3", "m4a", "aac", "ogg"].includes(extension)) return "audio";
  if (["json", "jsonl", "txt", "md", "html"].includes(extension)) return "document";
  if (["part", "tmp"].includes(extension)) return "temporary";
  return "other";
}

function dataFileKind(extension: string): "document" | "other" {
  return ["json", "jsonl", "txt", "xml", "db", "sqlite"].includes(extension) ? "document" : "other";
}

function storageMediaRole(area: "tasks" | "observations" | "productions" | "templates", path: string, sourceKind = ""): "user-video" | "parsed-video" | "parsed-audio" | "parsed-image" | "observation-image" | "production-asset" | "production-output" | "derived-frame" | "template-media" | "protected-other" {
  if (area === "tasks" && path.includes("/media/video")) return sourceKind === "local_video" ? "user-video" : "parsed-video";
  if (area === "tasks" && path.includes("/media/audio")) return "parsed-audio";
  if (area === "tasks" && path.includes("/media/image")) return "parsed-image";
  if (area === "observations") return "observation-image";
  if (area === "productions" && path.includes("/inputs/")) return "production-asset";
  if (area === "productions" && path.includes("output")) return "production-output";
  if (area === "productions" && path.includes("insight")) return "derived-frame";
  if (area === "templates") return "template-media";
  return "protected-other";
}

async function aiRequest(input: Json, emit: (event: Json) => void): Promise<void> {
  const requestId = stringValue(input.requestId);
  const state = await loadState();
  const connection = asRecord(state.connection);
  const apiKey = (await loadSecrets())["active-ai-connection"];
  if (!connection?.baseUrl || !apiKey) throw Object.assign(new Error("请先保存 AI 连接并写入 API Key"), { code: "ERR_AI_NOT_CONFIGURED" });
  const endpoint = resolveAiEndpoint(stringValue(connection.baseUrl), stringValue(input.relativePath));
  const headers = sanitizeAiHeaders(asRecord(input.headers));
  const body = asRecord(input.body);
  const timeoutMs = clamp(Number(input.timeoutMs ?? 60_000), 1_000, 180_000);
  const init: RequestInit = {
    method: "POST",
    headers: { ...headers, authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "manual",
  };
  if (body.kind === "multipart") {
    const multipart = asRecord(body.file);
    const form = new FormData();
    for (const [name, value] of Object.entries(asRecord(body.fields))) form.append(name, String(value));
    form.append(stringValue(multipart.filename) || "file", new Blob([await materializeBytes(asRecord(multipart.source))]), stringValue(multipart.filename) || "file");
    const requestHeaders = { ...(init.headers as Record<string, string>) };
    delete requestHeaders["content-type"];
    init.headers = requestHeaders;
    init.body = form;
  } else {
    init.headers = { ...init.headers, "content-type": headers["content-type"] || "application/json; charset=utf-8" };
    init.body = await materializeJson(stringValue(body.json), Array.isArray(body.attachments) ? body.attachments : []);
  }
  let response: Response | undefined;
  let currentEndpoint = endpoint;
  const endpointOrigin = new URL(endpoint).origin;
  try {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      response = await fetch(currentEndpoint, init);
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) throw codedError("ERR_AI_REDIRECT_INVALID", "AI 跳转地址无效");
      const next = publicHttps(new URL(location, currentEndpoint).toString());
      if (new URL(next).origin !== endpointOrigin) throw codedError("ERR_AI_REDIRECT_INVALID", "AI 跳转超出已配置地址");
      await response.body?.cancel();
      currentEndpoint = next;
      response = undefined;
    }
  } catch (error) {
    if (isCodedError(error)) throw error;
    throw codedError(classifyAiError(error), "本地 AI 请求失败");
  }
  if (!response) throw codedError("ERR_AI_REDIRECT_LIMIT", "AI 跳转次数过多");
  emit({ type: "started", status: response.status, headers: publicResponseHeaders(response.headers) });
  let sequence = 0;
  if (stringValue(input.responseMode) === "stream") {
    if (!response.body) {
      emit({ type: "completed", sequence: ++sequence });
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_TEXT_BYTES) throw codedError("ERR_AI_RESPONSE_TOO_LARGE", "AI 响应超过安全大小限制");
        emit({ type: "chunk", sequence: ++sequence, chunk: decoder.decode(value, { stream: true }) });
      }
    } finally {
      reader.releaseLock();
    }
    emit({ type: "completed", sequence: ++sequence });
    return;
  }
  const responseBytes = Buffer.from(await response.arrayBuffer());
  if (responseBytes.byteLength > MAX_TEXT_BYTES) throw codedError("ERR_AI_RESPONSE_TOO_LARGE", "AI 响应超过安全大小限制");
  const text = responseBytes.toString("utf8");
  emit({ type: "completed", sequence: ++sequence, bodyText: text });
  void requestId;
}

async function remux(input: Json): Promise<Json> {
  const taskId = stringValue(input.taskId);
  const outputRelative = "media/.remux.mp4";
  const output = diskPath("tasks", taskId, outputRelative);
  const args = input.audioUri
    ? ["-y", "-i", uriToDisk(stringValue(input.videoUri)), "-i", uriToDisk(stringValue(input.audioUri)), "-c", "copy", "-movflags", "+faststart", output]
    : ["-y", "-i", uriToDisk(stringValue(input.videoUri)), "-c", "copy", "-movflags", "+faststart", output];
  await mkdir(dirname(output), { recursive: true });
  try {
    await run("ffmpeg", args);
  } catch {
    const fallback = input.audioUri
      ? ["-y", "-i", uriToDisk(stringValue(input.videoUri)), "-i", uriToDisk(stringValue(input.audioUri)), "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", output]
      : ["-y", "-i", uriToDisk(stringValue(input.videoUri)), "-c:v", "copy", "-movflags", "+faststart", output];
    await run("ffmpeg", fallback);
  }
  const info = await stat(output);
  return { uri: `${PRIVATE_PREFIX}tasks/${taskId}/${outputRelative}`, sizeBytes: info.size, mimeType: "video/mp4", hasAudio: Boolean(input.audioUri) };
}

async function extractWav(input: Json): Promise<Json> {
  const taskId = stringValue(input.taskId);
  const relativePath = "media/.extract.wav";
  const output = diskPath("tasks", taskId, relativePath);
  await mkdir(dirname(output), { recursive: true });
  await run("ffmpeg", ["-y", "-i", uriToDisk(stringValue(input.sourceUri)), "-vn", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", "-c:a", "pcm_s16le", output]);
  const info = await stat(output);
  return { uri: `${PRIVATE_PREFIX}tasks/${taskId}/${relativePath}`, sizeBytes: info.size, sampleRateHz: 16_000, channelCount: 1 };
}

async function segmentWav(input: Json): Promise<Json> {
  const taskId = stringValue(input.taskId);
  const source = uriToDisk(stringValue(input.sourceUri));
  const durationMs = Math.round(await probeSeconds(source) * 1_000);
  const maxMs = clamp(Number(input.maxSegmentDurationMs ?? 30_000), 1_000, 120_000);
  const directory = diskPath("tasks", taskId, "media/segments");
  await mkdir(directory, { recursive: true });
  await run("ffmpeg", ["-y", "-i", source, "-f", "segment", "-segment_time", String(maxMs / 1_000), "-reset_timestamps", "1", "-c:a", "pcm_s16le", join(directory, "segment-%04d.wav")]);
  const names = (await readdir(directory)).filter((name) => /^segment-\d+\.wav$/i.test(name)).sort();
  const segments = [];
  for (const name of names) {
    const file = join(directory, name);
    const info = await stat(file);
    const duration = await probeSeconds(file);
    segments.push({
      uri: `${PRIVATE_PREFIX}tasks/${taskId}/media/segments/${name}`,
      sizeBytes: info.size,
      durationMs: Math.round(duration * 1_000),
      sampleRateHz: 16_000,
      channelCount: 1,
    });
  }
  return { sourceDurationMs: durationMs, segments };
}

async function probeSeconds(file: string): Promise<number> {
  const output = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
  const duration = Number(output.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw Object.assign(new Error("无法读取媒体时长"), { code: "ERR_MEDIA_PROBE_FAILED" });
  return duration;
}

function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(`${command} failed`));
    });
  });
}

async function serveFile(url: URL, res: ServerResponse): Promise<void> {
  if (url.searchParams.get("t") !== token) {
    writeJson(res, 403, { code: "ERR_APP_RUNTIME_UNAVAILABLE", message: "浏览器本地文件未授权" });
    return;
  }
  try {
    const data = await readFile(uriToDisk(url.searchParams.get("uri") ?? ""));
    res.statusCode = 200;
    res.setHeader("content-type", mimeOf(url.searchParams.get("uri") ?? ""));
    res.setHeader("cache-control", "no-store");
    res.end(data);
  } catch {
    writeJson(res, 404, { code: "ERR_MEDIA_READ_FAILED", message: "本地文件不存在" });
  }
}

async function writeBinary(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const uri = String(req.headers["x-hongtai-uri"] ?? "");
  const mimeType = String(req.headers["x-hongtai-mime"] ?? "");
  const destination = uriToDisk(uri);
  const temporary = temporaryPath(destination, "part");
  await mkdir(dirname(destination), { recursive: true });
  const file = createWriteStream(temporary);
  let written = 0;
  let ended = false;
  try {
    for await (const chunk of req) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      written += value.byteLength;
      if (written > MAX_DOWNLOAD_BYTES) {
        throw codedError("ERR_STORAGE_SPACE_INSUFFICIENT", "媒体文件超过本地下载限制");
      }
      await new Promise<void>((resolve, reject) => file.write(value, (error) => error ? reject(error) : resolve()));
    }
    await new Promise<void>((resolve) => file.end(() => resolve()));
    ended = true;
    await replaceFile(temporary, destination);
    const info = await stat(destination);
    writeJson(res, 200, { uri, sizeBytes: info.size, ...(mimeType ? { mimeType } : {}) });
  } finally {
    if (!ended) await new Promise<void>((resolve) => file.end(() => resolve()));
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function artifactPath(artifact: Json): string {
  const kind = stringValue(artifact.kind);
  if (kind === "video") return "media/video.mp4";
  if (kind === "videoPart") return "media/video-source.bin";
  if (kind === "audio") return "media/audio-source.bin";
  if (kind === "image") return `media/images/image-${clamp(Number(artifact.index ?? 0), 0, 99)}.bin`;
  throw Object.assign(new Error("下载目标无效"), { code: "ERR_MEDIA_DOWNLOAD_FAILED" });
}

function publicHttps(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw Object.assign(new Error("只允许访问公开 HTTPS 地址"), { code: "ERR_LINK_REQUEST_INVALID" });
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || isPrivateNetworkLiteral(host)) {
    throw Object.assign(new Error("禁止访问本地网络地址"), { code: "ERR_LINK_REQUEST_INVALID" });
  }
  return parsed.toString();
}

function isPrivateNetworkLiteral(host: string): boolean {
  const version = isIP(host);
  if (version === 4) {
    const octets = host.split(".").map(Number);
    const [first = -1, second = -1, third = -1] = octets;
    return first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0 && third === 0) ||
      (first === 192 && second === 0 && third === 2) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113);
  }
  if (version === 6) {
    const compressedIpv4 = host.match(/^(?:::ffff:|::)(\d{1,3}(?:\.\d{1,3}){3})$/iu)?.[1];
    if (compressedIpv4 && isIP(compressedIpv4) === 4) return isPrivateNetworkLiteral(compressedIpv4);
    const normalized = host.replace(/^(?:0+:){5}(?:ffff:|0:)/u, "");
    if (isIP(normalized) === 4) return isPrivateNetworkLiteral(normalized);
    return host === "::1" || host === "::" || /^(?:fc|fd|fe[89ab])/u.test(host);
  }
  return false;
}

function resolveAiEndpoint(baseUrl: string, relativePath: string): string {
  const base = new URL(publicHttps(baseUrl));
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("://") || relativePath.includes("?") || relativePath.includes("#") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw Object.assign(new Error("AI 请求路径无效"), { code: "ERR_AI_REQUEST_INVALID" });
  }
  return `${base.origin}${base.pathname.replace(/\/$/, "")}/${relativePath}`;
}

function sanitizeHeaders(headers: Json, allowed: Set<string>, max: number): Record<string, string> {
  const entries = Object.entries(headers);
  if (entries.length > max) throw Object.assign(new Error("请求头数量超出限制"), { code: "ERR_LINK_REQUEST_INVALID" });
  const result: Record<string, string> = {};
  for (const [name, value] of entries) {
    const normalized = name.toLowerCase();
    if (!allowed.has(normalized) || typeof value !== "string" || value.length > 512 || /[\r\n]/.test(value)) {
      throw Object.assign(new Error("请求头不被允许"), { code: "ERR_LINK_REQUEST_INVALID" });
    }
    result[normalized] = value;
  }
  return result;
}

function sanitizeAiHeaders(headers: Json): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (FORBIDDEN_AI_HEADERS.has(normalized) || typeof value !== "string" || /[\r\n]/.test(value)) {
      throw Object.assign(new Error("AI 请求头无效"), { code: "ERR_AI_REQUEST_INVALID" });
    }
    result[normalized] = value;
  }
  return result;
}

function publicResponseHeaders(headers: Headers): Record<string, string> {
  const allowed = new Set(["content-type", "content-length", "etag", "last-modified", "cache-control", "x-request-id", "location"]);
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (allowed.has(name.toLowerCase())) result[name.toLowerCase()] = value;
  });
  return result;
}

async function materializeJson(json: string, attachments: readonly unknown[]): Promise<string> {
  if (Buffer.byteLength(json) > MAX_JSON_REQUEST_BYTES) throw Object.assign(new Error("AI JSON 过大"), { code: "ERR_AI_REQUEST_INVALID" });
  const document = JSON.parse(json) as unknown;
  for (const attachment of attachments) {
    const item = asRecord(attachment);
    const bytes = await materializeBytes(asRecord(item.source));
    const base64 = Buffer.from(bytes).toString("base64");
    const mimeType = stringValue(item.mimeType);
    const value = stringValue(item.materialization) === "data-url-base64" ? `data:${mimeType};base64,${base64}` : base64;
    setPointer(document, stringValue(item.pointer), value);
  }
  return JSON.stringify(document);
}

async function materializeBytes(source: Json): Promise<Buffer> {
  if (stringValue(source.kind) === "base64") return Buffer.from(stringValue(source.base64), "base64");
  return readFile(uriToDisk(stringValue(source.uri)));
}

function setPointer(document: unknown, pointer: string, value: string): void {
  const parts = pointer.split("/").slice(1).map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  let current: unknown = document;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index] ?? "";
    current = Array.isArray(current) ? current[Number(key)] : asRecord(current)[key];
  }
  const last = parts.at(-1) ?? "";
  if (Array.isArray(current)) current[Number(last)] = value;
  else asRecord(current)[last] = value;
}

function areaDir(area: string, id: string): string {
  if (!["tasks", "observations", "productions", "templates", "profile"].includes(area) || !ID_PATTERN.test(id)) {
    throw Object.assign(new Error("本地目录无效"), { code: "ERR_APP_RUNTIME_UNAVAILABLE" });
  }
  return join(rootDir, area, id);
}

function diskPath(area: string, id: string, relativePath: string): string {
  const root = areaDir(area, id);
  const safe = relativePath.split("/").filter((part) => part && part !== "." && part !== ".." && !part.includes("\\") && !part.includes("\0"));
  if (safe.length === 0 || safe.join("/") !== relativePath.replaceAll("\\", "/")) {
    throw Object.assign(new Error("本地路径无效"), { code: "ERR_APP_RUNTIME_UNAVAILABLE" });
  }
  const resolved = resolve(root, ...safe);
  if (relative(root, resolved).startsWith("..") || resolved === root) {
    throw Object.assign(new Error("本地路径无效"), { code: "ERR_APP_RUNTIME_UNAVAILABLE" });
  }
  return resolved;
}

function uriToDisk(uri: string): string {
  if (!uri.startsWith(PRIVATE_PREFIX)) throw Object.assign(new Error("不是受控的本地文件"), { code: "ERR_MEDIA_READ_FAILED" });
  const rest = uri.slice(PRIVATE_PREFIX.length);
  const [area, id, ...pathParts] = rest.split("/");
  return diskPath(area ?? "", id ?? "", pathParts.join("/"));
}

async function fileInfo(area: string, id: string, relativePath: string): Promise<Json> {
  const file = diskPath(area, id, relativePath);
  if (!await exists(file)) return {};
  const info = await stat(file);
  return { uri: `${PRIVATE_PREFIX}${area}/${id}/${relativePath}`, sizeBytes: info.size, mimeType: mimeOf(file) };
}

async function writeTextFile(area: string, id: string, relativePath: string, value: string, replace: boolean): Promise<void> {
  const file = diskPath(area, id, relativePath);
  await mkdir(dirname(file), { recursive: true });
  if (replace) await writeTextAtomically(file, value);
  else await appendFile(file, value, "utf8");
}

async function copyUri(sourceUri: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  await copyFileAtomically(uriToDisk(sourceUri), destination);
}

async function listIds(area: string): Promise<string[]> {
  try {
    const entries = await readdir(join(rootDir, area), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name)).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function loadSecrets(): Promise<Record<string, string>> {
  return { ...volatileSecrets };
}

async function saveSecrets(value: Record<string, string>): Promise<void> {
  volatileSecrets = { ...value };
}

async function loadState(): Promise<{ profile?: Json; connection?: Json }> {
  try {
    return JSON.parse(await readFile(join(rootDir, "state.json"), "utf8")) as { profile?: Json; connection?: Json };
  } catch {
    return {};
  }
}

async function saveState(value: { profile?: Json; connection?: Json }): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeTextAtomically(join(rootDir, "state.json"), JSON.stringify(value));
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readJsonBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_REQUEST_BYTES) throw Object.assign(new Error("请求过大"), { code: "ERR_APP_RUNTIME_UNAVAILABLE" });
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return asRecord(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

function writeJson(res: ServerResponse, status: number, body: Json): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function failure(error: unknown): Json {
  const record = typeof error === "object" && error !== null ? error as Json : {};
  return {
    type: "failed",
    code: typeof record.code === "string" ? record.code : "ERR_APP_RUNTIME_UNAVAILABLE",
    message: error instanceof Error ? error.message.slice(0, 280) : "浏览器本地 I/O 失败",
  };
}

function isCodedError(error: unknown): boolean {
  return typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string";
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function classifyLinkError(error: unknown, fallback = "ERR_LINK_CONNECTION_FAILED"): string {
  const name = error instanceof Error ? error.name : "";
  const text = error instanceof Error ? error.message : "";
  if (name === "TimeoutError" || name === "AbortError" || /timeout/i.test(text)) return "ERR_LINK_TIMEOUT";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) return "ERR_LINK_DNS_FAILED";
  if (/CERT|UNABLE_TO_VERIFY|ERR_TLS|SSL/i.test(text)) return "ERR_LINK_TLS_FAILED";
  return fallback;
}

function classifyAiError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const text = error instanceof Error ? error.message : "";
  if (name === "TimeoutError" || name === "AbortError" || /timeout/i.test(text)) return "ERR_AI_TIMEOUT";
  return "ERR_AI_NETWORK_FAILED";
}

async function seedFromLocalEnv(): Promise<void> {
  const envFile = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", ".env");
  try {
    process.loadEnvFile(envFile);
  } catch {
    return;
  }
  const baseUrl = process.env.HONGTAI_AI_BASE_URL?.trim() ?? "";
  const apiKey = process.env.HONGTAI_AI_API_KEY?.trim() ?? "";
  const textModel = process.env.HONGTAI_TEXT_MODEL?.trim() ?? "";
  if (!baseUrl || !apiKey || !textModel) return;
  const secrets = await loadSecrets();
  const state = await loadState();
  const asrTransport = process.env.HONGTAI_AI_ASR_TRANSPORT?.trim() === "chat-input-audio"
    ? "chat-input-audio"
    : process.env.HONGTAI_AI_ASR_TRANSPORT?.trim() === "stepaudio-sse"
      ? "stepaudio-sse"
      : "audio-transcriptions";
  if (!secrets["active-ai-connection"]) {
    volatileSecrets = { ...secrets, "active-ai-connection": apiKey };
  }
  if (state.connection) return;
  const now = Date.now();
  await saveState({
    ...state,
    connection: {
      connectionId: "active",
      baseUrl,
      textModel,
      visionModel: process.env.HONGTAI_VISION_MODEL?.trim() || null,
      asrModel: process.env.HONGTAI_ASR_MODEL?.trim() || null,
      asrTransport,
      ttsModel: null,
      ttsTransport: null,
      ttsVoice: null,
      jsonObjectEnabled: process.env.HONGTAI_AI_JSON_OBJECT?.trim().toLowerCase() !== "false",
      jsonSchemaEnabled: process.env.HONGTAI_AI_JSON_SCHEMA?.trim().toLowerCase() === "true",
      probeResultsJson: "[]",
      createdAtEpochMs: now,
      updatedAtEpochMs: now,
    },
  });
}

function asRecord(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function entityId(input: Json): string {
  return stringValue(input.id) || stringValue(input.taskId) || stringValue(input.sessionId) || stringValue(input.projectId) || stringValue(input.templateId);
}

function mimeOf(file: string): string {
  if (file.endsWith(".mp4")) return "video/mp4";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".wav")) return "audio/wav";
  if (file.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}
