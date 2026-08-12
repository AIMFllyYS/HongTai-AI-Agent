import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { TaskError } from "../packages/core/src/index";
import { SharpImagePreprocessor } from "../packages/node-runtime/src/index";

const FIXTURE_PATH = join(process.cwd(), "tests", "fixtures", "images", "sharp-orientation-6.jpg");
const require = createRequire(join(process.cwd(), "packages", "node-runtime", "package.json"));

interface SharpMetadata {
  readonly format?: string;
  readonly width?: number;
  readonly height?: number;
  readonly orientation?: number;
}

interface SharpRawResult {
  readonly data: Buffer;
  readonly info: { readonly channels: number; readonly width: number; readonly height: number };
}

interface SharpPipeline {
  metadata(): Promise<SharpMetadata>;
  removeAlpha(): SharpPipeline;
  raw(): SharpPipeline;
  toBuffer(options: { readonly resolveWithObject: true }): Promise<SharpRawResult>;
}

const sharp = require("sharp") as (input: Uint8Array) => SharpPipeline;

function isTaskIssue(code: "IMAGE_INVALID" | "IMAGE_TOO_LARGE") {
  return (error: unknown): boolean => error instanceof TaskError && error.code === code && error.action === "edit_input";
}

function pixelAt(data: Buffer, width: number, x: number, y: number): readonly [number, number, number] {
  const offset = (y * width + x) * 3;
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!];
}

function assertDominantColor(
  actual: readonly [number, number, number],
  expected: "red" | "green" | "blue" | "yellow",
): void {
  const [red, green, blue] = actual;
  if (expected === "red") assert.ok(red > 180 && green < 70 && blue < 70, `expected red, got ${actual.join(",")}`);
  if (expected === "green") assert.ok(green > 100 && red < 70 && blue < 70, `expected green, got ${actual.join(",")}`);
  if (expected === "blue") assert.ok(blue > 180 && red < 70 && green < 70, `expected blue, got ${actual.join(",")}`);
  if (expected === "yellow") assert.ok(red > 180 && green > 180 && blue < 70, `expected yellow, got ${actual.join(",")}`);
}

test("applies EXIF orientation, bounds the longest edge and emits orientation-free JPEG", async () => {
  const source = await readFile(FIXTURE_PATH);
  const result = await new SharpImagePreprocessor().normalize(source, "image/jpeg");

  assert.equal(result.mimeType, "image/jpeg");
  assert.equal(Buffer.from(result.data).subarray(0, 2).toString("hex"), "ffd8");
  const metadata = await sharp(result.data).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 1_024);
  assert.equal(metadata.height, 2_048);
  assert.equal(metadata.orientation, undefined);
  assert.ok(Math.max(metadata.width, metadata.height) <= 2_048);

  const { data, info } = await sharp(result.data).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 3);
  const quarterX = Math.floor(info.width / 4);
  const quarterY = Math.floor(info.height / 4);
  assertDominantColor(pixelAt(data, info.width, quarterX, quarterY), "blue");
  assertDominantColor(pixelAt(data, info.width, info.width - quarterX - 1, quarterY), "red");
  assertDominantColor(pixelAt(data, info.width, quarterX, info.height - quarterY - 1), "yellow");
  assertDominantColor(pixelAt(data, info.width, info.width - quarterX - 1, info.height - quarterY - 1), "green");
});

test("maps malformed, empty and unsupported inputs to the stable invalid-image issue", async () => {
  const preprocessor = new SharpImagePreprocessor();
  await assert.rejects(preprocessor.normalize(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg"), isTaskIssue("IMAGE_INVALID"));
  await assert.rejects(preprocessor.normalize(new Uint8Array(), "image/jpeg"), isTaskIssue("IMAGE_INVALID"));
  await assert.rejects(preprocessor.normalize(new Uint8Array([0x47, 0x49, 0x46]), "image/gif"), isTaskIssue("IMAGE_INVALID"));
});

test("rejects 15 MiB plus one byte with the stable size issue before decoding", async () => {
  const tooLarge = new Uint8Array(15 * 1024 * 1024 + 1);
  await assert.rejects(
    new SharpImagePreprocessor().normalize(tooLarge, "image/jpeg"),
    isTaskIssue("IMAGE_TOO_LARGE"),
  );
});
