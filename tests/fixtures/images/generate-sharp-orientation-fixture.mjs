import { Buffer } from "node:buffer";
import { log } from "node:console";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import process from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(root, "..", "..", "..", "packages", "node-runtime", "package.json"));
const sharp = require("sharp");
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1280" viewBox="0 0 2560 1280">
  <rect width="1280" height="640" x="0" y="0" fill="#ff0000"/>
  <rect width="1280" height="640" x="1280" y="0" fill="#00b000"/>
  <rect width="1280" height="640" x="0" y="640" fill="#0000ff"/>
  <rect width="1280" height="640" x="1280" y="640" fill="#ffff00"/>
</svg>`);

const output = await sharp(svg)
  .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
  .withMetadata({ orientation: 6 })
  .toBuffer();

await writeFile(join(root, "sharp-orientation-6.jpg"), output);
log(JSON.stringify({
  node: process.version,
  sharp: sharp.versions.sharp,
  vips: sharp.versions.vips,
  bytes: output.byteLength,
}));
