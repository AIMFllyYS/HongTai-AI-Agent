import sharp from "sharp";
import { TaskError } from "@hongtai/core";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

function startsWithBytes(data: Uint8Array, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => data[index] === byte);
}

/**
 * Reject MIME/signature mismatches before libvips sees the bytes. This keeps an
 * allowed upload from selecting an unneeded decoder such as GIF or TIFF merely
 * because the caller declared it as JPEG.
 */
export function hasExpectedImageSignature(data: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/jpeg") return startsWithBytes(data, [0xff, 0xd8, 0xff]);
  if (mimeType === "image/png") return startsWithBytes(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mimeType === "image/webp") {
    return startsWithBytes(data, [0x52, 0x49, 0x46, 0x46]) && startsWithBytes(data.subarray(8), [0x57, 0x45, 0x42, 0x50]);
  }
  return false;
}

export interface NormalizedImage {
  readonly mimeType: "image/jpeg";
  readonly data: Uint8Array;
}

export interface ImagePreprocessor {
  normalize(data: Uint8Array, mimeType: string): Promise<NormalizedImage>;
}

export class SharpImagePreprocessor implements ImagePreprocessor {
  async normalize(data: Uint8Array, mimeType: string): Promise<NormalizedImage> {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new TaskError({ code: "IMAGE_INVALID", message: "只支持JPEG、PNG和WebP图片", action: "edit_input" });
    }
    if (data.byteLength === 0) throw new TaskError({ code: "IMAGE_INVALID", message: "图片文件为空", action: "edit_input" });
    if (data.byteLength > 15 * 1024 * 1024) throw new TaskError({ code: "IMAGE_TOO_LARGE", message: "图片不能超过15MB", action: "edit_input" });
    if (!hasExpectedImageSignature(data, mimeType)) {
      throw new TaskError({ code: "IMAGE_INVALID", message: "图片声明类型与实际文件格式不一致", action: "edit_input" });
    }
    try {
      const input = new Uint8Array(data.byteLength);
      input.set(data);
      const image = sharp(input.buffer, { failOn: "error" });
      const metadata = await image.metadata();
      if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
        throw new TaskError({ code: "IMAGE_INVALID", message: "图片真实格式不受支持", action: "edit_input" });
      }
      const output = await image.rotate().resize({ width: 2_048, height: 2_048, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
      return { mimeType: "image/jpeg", data: output };
    } catch (error) {
      if (error instanceof TaskError) throw error;
      throw new TaskError({ code: "IMAGE_INVALID", message: "无法读取或规范化图片", action: "edit_input", cause: error });
    }
  }
}
