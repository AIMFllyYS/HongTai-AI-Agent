import { issueFromAppError, TaskError } from "@hongtai/core";
import type { DiagnosisImageRecovery, MediaReference } from "@hongtai/core";

const SUPPORTED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface StandaloneDiagnosisFileMedia {
  pickPhoto(): Promise<{ readonly uri: string; readonly mimeType?: string; readonly sizeBytes: number }>;
  capturePhoto(): Promise<{ readonly uri: string; readonly mimeType?: string; readonly sizeBytes: number }>;
  consumePhotoOperation(): Promise<
    | { readonly status: "none" }
    | {
        readonly status: "succeeded";
        readonly origin: "imported" | "captured";
        readonly uri: string;
        readonly mimeType?: string;
        readonly sizeBytes: number;
      }
    | { readonly status: "failed"; readonly code: string }
  >;
}

function taskError(code: ConstructorParameters<typeof TaskError>[0]["code"], message: string, action: ConstructorParameters<typeof TaskError>[0]["action"] = "none"): TaskError {
  return new TaskError({ code, message, action });
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined;
}

export function validMime(value: string | undefined): string {
  const mime = value?.trim().toLowerCase() ?? "";
  if (!SUPPORTED_IMAGE_MIME.has(mime)) throw taskError("IMAGE_INVALID", "请选择有效的 JPEG、PNG 或 WebP 照片", "select_media");
  return mime;
}

export function imagePath(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg": return "image.jpg";
    case "image/png": return "image.png";
    case "image/webp": return "image.webp";
    default: return "image.bin";
  }
}

export function imageTaskError(nativeCode: string | undefined, cause: unknown): TaskError {
  switch (nativeCode) {
    case "ERR_MEDIA_SELECTION_CANCELLED":
      return new TaskError({ code: "MEDIA_SELECTION_CANCELLED", message: "已取消选择或拍摄图片", action: "select_media", cause });
    case "ERR_MEDIA_SOURCE_MISSING":
      return new TaskError({ code: "MEDIA_SOURCE_NOT_FOUND", message: "系统没有返回可读取的图片", action: "select_media", cause });
    case "ERR_PHOTO_CAPTURE_LOST":
    case "ERR_PHOTO_RECOVERY_FAILED":
      return new TaskError({ code: "TASK_INTERRUPTED", message: "图片操作在应用重建后无法恢复，请重新选择或拍摄", action: "select_media", cause });
    case "ERR_MEDIA_READ_FAILED":
      return new TaskError({ code: "MEDIA_READ_FAILED", message: "无法继续读取系统返回的图片", action: "select_media", cause });
    case "ERR_IMAGE_TOO_LARGE":
      return new TaskError({ code: "IMAGE_TOO_LARGE", message: "图片不能超过15MB", action: "select_media", cause });
    case "ERR_IMAGE_INVALID":
      return new TaskError({ code: "IMAGE_INVALID", message: "无法读取或规范化图片", action: "select_media", cause });
    default:
      return new TaskError({ code: "MEDIA_IMPORT_FAILED", message: "图片没有成功导入应用私有目录", action: "select_media", cause });
  }
}

export function imageImportError(error: unknown): TaskError {
  if (error instanceof TaskError) return error;
  const nativeCode = typeof record(error)?.code === "string" ? record(error)?.code as string : undefined;
  return imageTaskError(nativeCode, error);
}

export class DiagnosisPickedImages {
  readonly #toDisplayUri: (nativeUri: string) => string;
  readonly #picked = new Map<string, { readonly nativeUri: string; readonly mimeType: string; readonly sizeBytes: number }>();

  constructor(toDisplayUri: (nativeUri: string) => string) {
    this.#toDisplayUri = toDisplayUri;
  }

  get(uri: string): { readonly nativeUri: string; readonly mimeType: string; readonly sizeBytes: number } | undefined {
    return this.#picked.get(uri);
  }

  async pickedImage(
    pick: () => Promise<{ readonly uri: string; readonly mimeType?: string; readonly sizeBytes: number }>,
    origin: MediaReference["origin"],
  ): Promise<MediaReference> {
    const raw = await pick().catch((error: unknown) => { throw imageImportError(error); });
    return this.rememberPicked(raw, origin);
  }

  rememberPicked(
    raw: { readonly uri: string; readonly mimeType?: string; readonly sizeBytes: number },
    origin: MediaReference["origin"],
  ): MediaReference {
    const mimeType = validMime(raw.mimeType);
    if (!raw.uri || !Number.isFinite(raw.sizeBytes) || raw.sizeBytes <= 0) throw taskError("MEDIA_IMPORT_FAILED", "图片导入没有返回有效的私有文件", "select_media");
    const uri = this.#toDisplayUri(raw.uri);
    this.#picked.set(uri, { nativeUri: raw.uri, mimeType, sizeBytes: raw.sizeBytes });
    return { uri, kind: "image", origin, mimeType, byteLength: raw.sizeBytes, displayName: "已导入图片" };
  }

  async consumeImageRecovery(fileMedia: StandaloneDiagnosisFileMedia): Promise<DiagnosisImageRecovery> {
    let recovered: Awaited<ReturnType<StandaloneDiagnosisFileMedia["consumePhotoOperation"]>>;
    try {
      recovered = await fileMedia.consumePhotoOperation();
    } catch (error) {
      return { status: "failed", issue: issueFromAppError(imageImportError(error)) };
    }
    if (recovered.status === "none") return { status: "none" };
    if (recovered.status === "failed") {
      const cause = { code: recovered.code };
      return { status: "failed", issue: issueFromAppError(imageTaskError(recovered.code, cause)) };
    }
    return { status: "succeeded", image: this.rememberPicked(recovered, recovered.origin) };
  }
}
