/**
 * Renders the built-in decoration catalogue to original SVG sources and RGBA PNGs.
 *
 * No extra packages: Node zlib encodes PNG, and a small coverage rasterizer draws circles,
 * capsules and polygons. Third-party emoji, logos and downloaded stickers are forbidden here.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 256;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SVG_DIR = join(ROOT, "scripts", "decorations");
const PNG_DIR = join(ROOT, "apps", "web", "public", "decorations");

const TEAL = [100, 244, 218, 255];
const DEEP = [0, 52, 43, 255];
const GOLD = [255, 226, 77, 255];
const WHITE = [255, 255, 255, 255];
const ORANGE = [185, 97, 0, 255];

/** @typedef {[number, number, number, number]} Rgba */

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const payload = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, crc]);
}

function encodePng(rgba) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (SIZE * 4 + 1)] = 0;
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function blend(dst, index, rgba, cover) {
  if (cover <= 0) return;
  const a = (rgba[3] / 255) * Math.min(1, cover);
  const inv = 1 - a;
  dst[index] = Math.round(dst[index] * inv + rgba[0] * a);
  dst[index + 1] = Math.round(dst[index + 1] * inv + rgba[1] * a);
  dst[index + 2] = Math.round(dst[index + 2] * inv + rgba[2] * a);
  dst[index + 3] = Math.round(dst[index + 3] * inv + 255 * a);
}

function diskCover(px, py, cx, cy, radius) {
  const distance = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
  if (distance <= radius - 0.55) return 1;
  if (distance >= radius + 0.55) return 0;
  return radius + 0.55 - distance;
}

function ringCover(px, py, cx, cy, radius, width) {
  return Math.max(0, diskCover(px, py, cx, cy, radius + width / 2) - diskCover(px, py, cx, cy, radius - width / 2));
}

function capsuleCover(px, py, x0, y0, x1, y1, radius) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy) || 1;
  const t = Math.max(0, Math.min(1, ((px + 0.5 - x0) * dx + (py + 0.5 - y0) * dy) / (length * length)));
  return diskCover(px, py, x0 + dx * t, y0 + dy * t, radius);
}

function insidePolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-6) + xi) inside = !inside;
  }
  return inside;
}

function polygonCover(px, py, points) {
  const samples = [
    [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75],
  ];
  let hits = 0;
  for (const [ox, oy] of samples) if (insidePolygon(px + ox, py + oy, points)) hits += 1;
  return hits / samples.length;
}

function starPoints(cx, cy, outer, inner, count, rotation) {
  const points = [];
  for (let i = 0; i < count * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = rotation + (i * Math.PI) / count - Math.PI / 2;
    points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return points;
}

function paint(ops) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const index = (y * SIZE + x) * 4;
      for (const op of ops) {
        let cover = 0;
        if (op.type === "disk") cover = diskCover(x, y, op.cx, op.cy, op.r);
        else if (op.type === "ring") cover = ringCover(x, y, op.cx, op.cy, op.r, op.w);
        else if (op.type === "capsule") cover = capsuleCover(x, y, op.x0, op.y0, op.x1, op.y1, op.r);
        else if (op.type === "polygon") cover = polygonCover(x, y, op.points);
        if (cover > 0) blend(rgba, index, op.fill, cover);
      }
    }
  }
  return rgba;
}

function svgEscape(color) {
  const [r, g, b, a] = color;
  return a >= 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

function toSvg(ops) {
  const body = ops.map((op) => {
    if (op.type === "disk") {
      return `<circle cx="${op.cx}" cy="${op.cy}" r="${op.r}" fill="${svgEscape(op.fill)}"/>`;
    }
    if (op.type === "ring") {
      return `<circle cx="${op.cx}" cy="${op.cy}" r="${op.r}" fill="none" stroke="${svgEscape(op.fill)}" stroke-width="${op.w}"/>`;
    }
    if (op.type === "capsule") {
      return `<line x1="${op.x0}" y1="${op.y0}" x2="${op.x1}" y2="${op.y1}" stroke="${svgEscape(op.fill)}" stroke-width="${op.r * 2}" stroke-linecap="round"/>`;
    }
    const d = op.points.map((point, index) => `${index === 0 ? "M" : "L"}${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(" ") + " Z";
    return `<path d="${d}" fill="${svgEscape(op.fill)}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${body}</svg>\n`;
}

const ITEMS = {
  arrow_right: [
    { type: "disk", cx: 128, cy: 128, r: 112, fill: DEEP },
    { type: "polygon", points: [[86, 64], [86, 192], [196, 128]], fill: TEAL },
    { type: "polygon", points: [[98, 86], [98, 170], [176, 128]], fill: WHITE },
  ],
  star_mark: [
    { type: "disk", cx: 128, cy: 128, r: 118, fill: DEEP },
    { type: "polygon", points: starPoints(128, 128, 92, 38, 5, 0), fill: GOLD },
    { type: "polygon", points: starPoints(128, 132, 48, 20, 5, 0), fill: WHITE },
  ],
  check_mark: [
    { type: "disk", cx: 128, cy: 128, r: 112, fill: DEEP },
    { type: "disk", cx: 128, cy: 128, r: 96, fill: TEAL },
    { type: "capsule", x0: 78, y0: 132, x1: 112, y1: 168, r: 14, fill: DEEP },
    { type: "capsule", x0: 112, y0: 168, x1: 182, y1: 92, r: 14, fill: DEEP },
    { type: "capsule", x0: 80, y0: 130, x1: 112, y1: 164, r: 8, fill: WHITE },
    { type: "capsule", x0: 112, y0: 164, x1: 178, y1: 94, r: 8, fill: WHITE },
  ],
  badge_one: [
    { type: "disk", cx: 128, cy: 128, r: 114, fill: ORANGE },
    { type: "ring", cx: 128, cy: 128, r: 98, w: 14, fill: WHITE },
    { type: "capsule", x0: 128, y0: 78, x1: 128, y1: 178, r: 14, fill: WHITE },
    { type: "capsule", x0: 108, y0: 96, x1: 128, y1: 78, r: 10, fill: WHITE },
  ],
  sparkle: [
    { type: "polygon", points: starPoints(128, 128, 110, 28, 4, 0), fill: GOLD },
    { type: "polygon", points: starPoints(128, 128, 62, 16, 4, Math.PI / 4), fill: TEAL },
    { type: "disk", cx: 128, cy: 128, r: 18, fill: WHITE },
  ],
  underline_brush: [
    { type: "capsule", x0: 24, y0: 176, x1: 232, y1: 118, r: 22, fill: TEAL },
    { type: "capsule", x0: 40, y0: 168, x1: 216, y1: 114, r: 10, fill: WHITE },
    { type: "capsule", x0: 56, y0: 160, x1: 196, y1: 116, r: 4, fill: GOLD },
  ],
  speech_bubble: [
    { type: "disk", cx: 128, cy: 112, r: 92, fill: WHITE },
    { type: "ring", cx: 128, cy: 112, r: 92, w: 10, fill: DEEP },
    { type: "polygon", points: [[92, 176], [128, 176], [84, 226]], fill: WHITE },
    { type: "capsule", x0: 88, y0: 178, x1: 92, y1: 214, r: 5, fill: DEEP },
    { type: "capsule", x0: 84, y0: 112, x1: 172, y1: 112, r: 7, fill: TEAL },
    { type: "capsule", x0: 84, y0: 136, x1: 148, y1: 136, r: 7, fill: TEAL },
  ],
};

mkdirSync(SVG_DIR, { recursive: true });
mkdirSync(PNG_DIR, { recursive: true });

for (const [id, ops] of Object.entries(ITEMS)) {
  writeFileSync(join(SVG_DIR, `${id}.svg`), toSvg(ops));
  writeFileSync(join(PNG_DIR, `${id}.png`), encodePng(paint(ops)));
  process.stdout.write(`wrote ${id}\n`);
}
