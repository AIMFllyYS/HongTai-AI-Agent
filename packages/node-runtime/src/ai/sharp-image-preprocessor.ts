import sharp from "sharp";
import { TaskError } from "@hongtai/core";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

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
