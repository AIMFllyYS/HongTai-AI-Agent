import type {
  NativeAiRequestEvent,
  NativeDownloadProgressEvent,
  NativeProductionAsset,
  StandaloneNativePlugins,
} from "@hongtai/capacitor-runtime";

import { browserIoRpc, browserIoStream, browserIoWriteBinary, displayFileSrc, nativeFileUri } from "./io-client";
import { pickFiles } from "./pick-files";

type Listener<T> = (event: T) => void;

function createEmitter<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    add(listener: Listener<T>) {
      listeners.add(listener);
      return { remove: async () => { listeners.delete(listener); } };
    },
    emit(event: T) {
      for (const listener of listeners) listener(event);
    },
  };
}

function assetId(): string {
  return `asset-${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function extensionFor(file: File): string | undefined {
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "video/mp4") return "mp4";
  if (file.type === "audio/mpeg") return "mp3";
  if (file.type === "audio/mp4") return "m4a";
  if (file.type === "audio/wav") return "wav";
  return undefined;
}

export function createBrowserStandalonePlugins(): StandaloneNativePlugins {
  const aiEvents = createEmitter<NativeAiRequestEvent>();
  const downloadEvents = createEmitter<NativeDownloadProgressEvent>();

  return {
    secureSettings: {
      writeSecret: async ({ slot, value }) => {
        await browserIoRpc("secret.write", { slot, value });
      },
      hasSecret: async ({ slot }) => browserIoRpc<{ readonly exists: boolean }>("secret.has", { slot }),
      removeSecret: async ({ slot }) => {
        await browserIoRpc("secret.remove", { slot });
      },
    },
    deviceSettings: {
      getAppInfo: async () => ({ versionName: "browser-e2e", versionCode: 1 }),
    },
    localData: {
      getProfile: async () => browserIoRpc("localData.getProfile"),
      saveProfile: async (profile) => {
        await browserIoRpc("localData.saveProfile", profile);
      },
      getAiConnection: async () => browserIoRpc("localData.getAiConnection"),
      saveAiConnection: async (connection) => {
        await browserIoRpc("localData.saveAiConnection", connection);
      },
      compareAndSetAiProbeResults: async (options) => browserIoRpc("localData.compareAndSetAiProbeResults", options),
    },
    localFiles: {
      ensure: async ({ taskId }) => { await browserIoRpc("files.ensure", { area: "tasks", id: taskId }); },
      writeText: async (options) => { await browserIoRpc("files.writeText", { area: "tasks", ...options }); },
      appendText: async (options) => { await browserIoRpc("files.appendText", { area: "tasks", ...options }); },
      readText: async (options) => browserIoRpc("files.readText", { area: "tasks", ...options }),
      exists: async (options) => browserIoRpc("files.exists", { area: "tasks", ...options }),
      listTaskIds: async () => {
        const result = await browserIoRpc<{ readonly ids: readonly string[] }>("files.listIds", { area: "tasks" });
        return { taskIds: result.ids };
      },
      deleteTask: async ({ taskId }) => { await browserIoRpc("files.delete", { area: "tasks", id: taskId }); },
      getUri: async (options) => browserIoRpc("files.getUri", { area: "tasks", ...options }),
      copyPrivateFile: async (options) => { await browserIoRpc("files.copyPrivateFile", { area: "tasks", ...options }); },
      ensureObservation: async ({ sessionId }) => { await browserIoRpc("files.ensure", { area: "observations", id: sessionId }); },
      writeObservationText: async (options) => { await browserIoRpc("files.writeText", { area: "observations", id: options.sessionId, relativePath: options.relativePath, value: options.value, replace: options.replace }); },
      readObservationText: async (options) => browserIoRpc("files.readText", { area: "observations", id: options.sessionId, relativePath: options.relativePath }),
      listObservationIds: async () => {
        const result = await browserIoRpc<{ readonly ids: readonly string[] }>("files.listIds", { area: "observations" });
        return { sessionIds: result.ids };
      },
      copyToObservation: async (options) => browserIoRpc("files.copyTo", { area: "observations", id: options.sessionId, sourceUri: options.sourceUri, relativePath: options.relativePath }),
      getObservationUri: async (options) => browserIoRpc("files.getUri", { area: "observations", id: options.sessionId, relativePath: options.relativePath }),
      ensureProduction: async ({ projectId }) => { await browserIoRpc("files.ensure", { area: "productions", id: projectId }); },
      writeProductionText: async (options) => { await browserIoRpc("files.writeText", { area: "productions", id: options.projectId, relativePath: options.relativePath, value: options.value, replace: options.replace }); },
      readProductionText: async (options) => browserIoRpc("files.readText", { area: "productions", id: options.projectId, relativePath: options.relativePath }),
      listProductionIds: async () => {
        const result = await browserIoRpc<{ readonly ids: readonly string[] }>("files.listIds", { area: "productions" });
        return { projectIds: result.ids };
      },
      deleteProductionFile: async (options) => { await browserIoRpc("files.deleteFile", { area: "productions", id: options.projectId, relativePath: options.relativePath }); },
      deleteProduction: async ({ projectId }) => { await browserIoRpc("files.delete", { area: "productions", id: projectId }); },
      ensureTemplate: async ({ templateId }) => { await browserIoRpc("files.ensure", { area: "templates", id: templateId }); },
      writeTemplateText: async (options) => { await browserIoRpc("files.writeText", { area: "templates", id: options.templateId, relativePath: options.relativePath, value: options.value, replace: options.replace }); },
      readTemplateText: async (options) => browserIoRpc("files.readText", { area: "templates", id: options.templateId, relativePath: options.relativePath }),
      listTemplateIds: async () => {
        const result = await browserIoRpc<{ readonly ids: readonly string[] }>("files.listIds", { area: "templates" });
        return { templateIds: result.ids };
      },
      deleteTemplate: async ({ templateId }) => { await browserIoRpc("files.delete", { area: "templates", id: templateId }); },
    },
    nativeNetwork: {
      fetchText: async (options) => browserIoRpc("http.fetchText", options),
      download: async (options) => {
        let result: { readonly uri: string; readonly sizeBytes: number; readonly mimeType?: string } | undefined;
        await browserIoStream("http.download", options, (event) => {
          if (event.type === "progress") {
            downloadEvents.emit({
              taskId: options.taskId,
              artifact: options.artifact,
              downloadedBytes: Number(event.downloadedBytes ?? 0),
              ...(typeof event.totalBytes === "number" ? { totalBytes: event.totalBytes } : {}),
              ...(typeof event.progress === "number" ? { progress: event.progress } : {}),
            });
          }
          if (event.type === "completed") {
            result = {
              uri: String(event.uri ?? ""),
              sizeBytes: Number(event.sizeBytes ?? 0),
              ...(typeof event.mimeType === "string" ? { mimeType: event.mimeType } : {}),
            };
          }
          if (event.type === "failed") {
            throw Object.assign(new Error(typeof event.message === "string" ? event.message : "下载失败"), {
              code: typeof event.code === "string" ? event.code : "ERR_MEDIA_DOWNLOAD_FAILED",
            });
          }
        });
        if (!result?.uri) throw Object.assign(new Error("原生下载没有返回已保存的私有媒体"), { code: "ERR_MEDIA_DOWNLOAD_FAILED" });
        return result;
      },
      startAiRequest: async (options) => new Promise((resolve, reject) => {
        let settled = false;
        let lastSequence = 0;
        const nativeCode = (event: Readonly<Record<string, unknown>>) => typeof event.code === "string" ? event.code : "ERR_AI_NETWORK_FAILED";
        const nativeMessage = (event: Readonly<Record<string, unknown>>, fallback: string) => typeof event.message === "string" ? event.message : fallback;
        const fail = (error: unknown) => {
          const code = typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
            ? (error as { code: string }).code
            : "ERR_AI_NETWORK_FAILED";
          const message = error instanceof Error ? error.message : "本地 AI 请求失败";
          if (!settled) {
            settled = true;
            reject(Object.assign(new Error(message), { code }));
            return;
          }
          lastSequence += 1;
          aiEvents.emit({
            type: "failed",
            requestId: options.requestId,
            sequence: lastSequence,
            code,
            userMessage: message,
          });
        };
        void browserIoStream("http.aiRequest", options, (event) => {
          if (event.type === "started") {
            if (settled) return;
            settled = true;
            resolve({
              requestId: options.requestId,
              accepted: true,
              status: Number(event.status ?? 0),
              headers: typeof event.headers === "object" && event.headers !== null ? event.headers as Readonly<Record<string, string>> : {},
            });
            return;
          }
          if (event.type === "chunk" && typeof event.chunk === "string" && typeof event.sequence === "number") {
            lastSequence = event.sequence;
            aiEvents.emit({ type: "chunk", requestId: options.requestId, sequence: event.sequence, chunk: event.chunk });
            return;
          }
          if (event.type === "completed" && typeof event.sequence === "number") {
            lastSequence = event.sequence;
            aiEvents.emit({
              type: "completed",
              requestId: options.requestId,
              sequence: event.sequence,
              ...(typeof event.bodyText === "string" ? { bodyText: event.bodyText } : {}),
            });
            return;
          }
          if (event.type === "failed") {
            const sequence = typeof event.sequence === "number" ? event.sequence : lastSequence + 1;
            lastSequence = sequence;
            const error = Object.assign(new Error(nativeMessage(event, "本地 AI 请求失败")), { code: nativeCode(event) });
            if (!settled) {
              fail(error);
              return;
            }
            aiEvents.emit({
              type: "failed",
              requestId: options.requestId,
              sequence,
              code: nativeCode(event),
              userMessage: nativeMessage(event, "本地 AI 请求失败"),
              ...(event.retryable === true ? { retryable: true } : {}),
            });
          }
        }).then(() => {
          if (!settled) fail(Object.assign(new Error("本地 AI 请求未被安全接收"), { code: "ERR_AI_REQUEST_NOT_ACCEPTED" }));
        }).catch(fail);
      }),
      addListener: (eventName: "aiRequestEvent" | "downloadProgress", listener: ((event: NativeAiRequestEvent) => void) | ((event: NativeDownloadProgressEvent) => void)) => {
        if (eventName === "aiRequestEvent") return aiEvents.add(listener as (event: NativeAiRequestEvent) => void);
        return downloadEvents.add(listener as (event: NativeDownloadProgressEvent) => void);
      },
    },
    fileMedia: {
      pickPhoto: async () => importLocalImage("profile"),
      capturePhoto: async () => importLocalImage("profile"),
      pickVideo: async ({ taskId }) => {
        const [file] = await pickFiles({ accept: "video/mp4", multiple: false });
        if (!file || file.type !== "video/mp4") throw Object.assign(new Error("请选择 MP4 视频"), { code: "ERR_MEDIA_SOURCE_INVALID" });
        const relativePath = "media/video.mp4";
        const uri = nativeFileUri("tasks", taskId, relativePath);
        await browserIoRpc("files.ensure", { area: "tasks", id: taskId });
        const saved = await browserIoWriteBinary({ uri, mimeType: file.type, body: file });
        const probed = await browserIoRpc<{ readonly durationMs?: number }>("media.probe", { uri: saved.uri });
        return {
          uri: saved.uri,
          mimeType: "video/mp4" as const,
          displayName: file.name.slice(0, 120) || "video.mp4",
          sizeBytes: saved.sizeBytes,
          durationSeconds: (probed.durationMs ?? 0) / 1_000,
        };
      },
      consumePhotoOperation: async () => ({ status: "none" as const }),
      consumeVideoOperation: async () => ({ status: "none" as const }),
      copyFromUri: async ({ sourceUri, displayName }) => browserIoRpc("files.copyFromUri", { sourceUri, displayName }),
    },
    mediaRuntime: {
      remuxVideo: async (options) => browserIoRpc("media.remux", options),
      probe: async (options) => browserIoRpc("media.probe", options),
      extractPcmWav: async (options) => browserIoRpc("media.extractPcmWav", options),
      segmentPcmWav: async (options) => browserIoRpc("media.segmentPcmWav", options),
    },
    productionRuntime: {
      pickAssets: async ({ projectId, maxItems, selection }) => {
        const accept = selection === "avatar" ? "video/mp4" : "image/jpeg,image/png,image/webp,video/mp4";
        const files = await pickFiles({ accept, multiple: selection !== "avatar", maxItems: selection === "avatar" ? 1 : maxItems });
        await browserIoRpc("files.ensure", { area: "productions", id: projectId });
        const assets: NativeProductionAsset[] = [];
        for (const file of files) {
          const extension = extensionFor(file);
          if (!extension) throw Object.assign(new Error("素材格式不支持"), { code: "ERR_MEDIA_SOURCE_INVALID" });
          const id = assetId();
          const relativePath = `inputs/${id}.${extension}`;
          const uri = nativeFileUri("productions", projectId, relativePath);
          const saved = await browserIoWriteBinary({ uri, mimeType: file.type, body: file });
          const kind = file.type.startsWith("video/") ? "video" as const : file.type.startsWith("audio/") ? "audio" as const : "image" as const;
          const probed = kind === "image" ? undefined : await browserIoRpc<{ readonly durationMs?: number }>("media.probe", { uri: saved.uri });
          assets.push({
            id,
            uri: saved.uri,
            kind,
            role: selection === "avatar" ? "avatar" : kind === "audio" ? "music" : "visual",
            mimeType: file.type,
            displayName: file.name.slice(0, 120) || `${id}.${extension}`,
            sizeBytes: saved.sizeBytes,
            ...(probed?.durationMs ? { durationSeconds: probed.durationMs / 1_000 } : {}),
          });
        }
        return { assets };
      },
      consumeAssetOperation: async () => ({ status: "none" as const }),
      render: async () => {
        throw Object.assign(new Error("浏览器端测不执行 Media3 导出"), { code: "ERR_MEDIA_ENCODER_UNAVAILABLE" });
      },
      probeTts: async () => {
        await browserIoRpc("http.probeTts", {});
      },
    },
  };
}

export function browserConvertFileSrc(uri: string): string {
  return displayFileSrc(uri);
}

async function importLocalImage(areaId: string): Promise<{ readonly uri: string; readonly mimeType?: string; readonly sizeBytes: number }> {
  const [file] = await pickFiles({ accept: "image/jpeg,image/png,image/webp", multiple: false });
  if (!file) throw Object.assign(new Error("已取消选择"), { code: "ERR_MEDIA_SELECTION_CANCELLED" });
  const extension = extensionFor(file);
  if (!extension || file.type.startsWith("video/")) throw Object.assign(new Error("请选择图片"), { code: "ERR_IMAGE_INVALID" });
  const relativePath = `avatar/${assetId()}.${extension}`;
  const uri = nativeFileUri("profile", areaId, relativePath);
  await browserIoRpc("files.ensure", { area: "profile", id: areaId });
  return browserIoWriteBinary({ uri, mimeType: file.type, body: file });
}
