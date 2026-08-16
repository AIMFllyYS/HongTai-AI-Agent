import { asRecord, asString } from "../shared";

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
] as const;

export function wbiKeysFromNav(payload: unknown): { imgKey: string; subKey: string } | undefined {
  const wbi = asRecord(asRecord(asRecord(payload)?.data)?.wbi_img);
  const imgKey = keyFromWbiUrl(asString(wbi?.img_url));
  const subKey = keyFromWbiUrl(asString(wbi?.sub_url));
  return imgKey && subKey ? { imgKey, subKey } : undefined;
}

export function signWbiQuery(
  params: Readonly<Record<string, string | number>>,
  imgKey: string,
  subKey: string,
  wts: number,
): string {
  const signed: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    signed[key] = String(value).replace(/[!'()*]/g, "");
  }
  signed.wts = String(Math.floor(wts));
  const query = Object.keys(signed)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(signed[key] ?? "")}`)
    .join("&");
  return `${query}&w_rid=${md5Hex(query + mixinKey(imgKey, subKey))}`;
}

function keyFromWbiUrl(value: string | undefined): string | undefined {
  const file = value?.split("/").pop()?.split(".")[0];
  return file && /^[0-9a-f]{16,}$/i.test(file) ? file : undefined;
}

function mixinKey(imgKey: string, subKey: string): string {
  const raw = `${imgKey}${subKey}`;
  return MIXIN_KEY_ENC_TAB.map((index) => raw[index] ?? "").join("").slice(0, 32);
}

function md5Hex(source: string): string {
  const bytes = utf8Bytes(source);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 8) >> 6) + 1 << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLength, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 0x1_0000_0000), true);

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Int32Array(16);
    for (let index = 0; index < 16; index += 1) words[index] = view.getInt32(offset + index * 4, true);
    const original = { a, b, c, d };
    for (let index = 0; index < 64; index += 1) {
      const [f, g, s] = md5Round(index, b, c, d);
      const sum = unsigned(a + f + (MD5_K[index] ?? 0) + (words[g] ?? 0));
      a = d;
      d = c;
      c = b;
      b = unsigned(b + rotateLeft(sum, s));
    }
    a = unsigned(a + original.a);
    b = unsigned(b + original.b);
    c = unsigned(c + original.c);
    d = unsigned(d + original.d);
  }
  return [a, b, c, d].map((value) => toLittleEndianHex(value)).join("");
}

function md5Round(index: number, b: number, c: number, d: number): readonly [number, number, number] {
  if (index < 16) return [(b & c) | (~b & d), index, [7, 12, 17, 22][index % 4] ?? 7];
  if (index < 32) return [(b & d) | (c & ~d), (5 * index + 1) % 16, [5, 9, 14, 20][index % 4] ?? 5];
  if (index < 48) return [b ^ c ^ d, (3 * index + 5) % 16, [4, 11, 16, 23][index % 4] ?? 4];
  return [c ^ (b | ~d), (7 * index) % 16, [6, 10, 15, 21][index % 4] ?? 6];
}

function utf8Bytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return Uint8Array.from(bytes);
}

function rotateLeft(value: number, bits: number): number {
  return unsigned((value << bits) | (value >>> (32 - bits)));
}

function unsigned(value: number): number {
  return value >>> 0;
}

function toLittleEndianHex(value: number): string {
  return [0, 8, 16, 24].map((shift) => ((value >>> shift) & 0xff).toString(16).padStart(2, "0")).join("");
}

const MD5_K = Uint32Array.from({ length: 64 }, (_, index) => Math.floor(2 ** 32 * Math.abs(Math.sin(index + 1))));
