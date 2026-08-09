#!/usr/bin/env python3
"""Generate the synthetic HEIF instrumentation corpus; never used by the APK."""

from __future__ import annotations

import hashlib
import struct
from pathlib import Path

import pillow_heif
from PIL import Image, ImageDraw
from pillow_heif._lib_info import libheif_info
from pillow_heif.constants import HeifCompressionFormat
from pillow_heif.misc import CtxEncode


EXPECTED_PILLOW_HEIF = "1.4.0"
EXPECTED_LIBHEIF = "1.23.0"
EXPECTED_ENCODER = "x265 HEVC encoder (4.2+1-e444744)"
WIDTH = 96
HEIGHT = 64
ROOT = Path(__file__).resolve().parent.parent


def require_pinned_host_encoder() -> None:
    info = libheif_info()
    if pillow_heif.__version__ != EXPECTED_PILLOW_HEIF:
        raise RuntimeError(f"Expected pillow-heif {EXPECTED_PILLOW_HEIF}, got {pillow_heif.__version__}")
    if info["libheif"] != EXPECTED_LIBHEIF or info["HEIF"] != EXPECTED_ENCODER:
        raise RuntimeError(f"Unexpected fixture encoder: {info}")


def source_pixels() -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, WIDTH // 2 - 1, HEIGHT // 2 - 1), fill=(232, 35, 42))
    draw.rectangle((WIDTH // 2, 0, WIDTH - 1, HEIGHT // 2 - 1), fill=(25, 170, 75))
    draw.rectangle((0, HEIGHT // 2, WIDTH // 2 - 1, HEIGHT - 1), fill=(35, 85, 220))
    draw.rectangle((WIDTH // 2, HEIGHT // 2, WIDTH - 1, HEIGHT - 1), fill=(245, 200, 35))
    return image


def encode_heic(image: Image.Image, destination: Path, orientation: int = 1) -> None:
    encoder = CtxEncode(HeifCompressionFormat.HEVC, quality=95, chroma=444)
    encoder.add_image(
        image.size,
        image.mode,
        image.tobytes(),
        primary=True,
        image_orientation=orientation,
    )
    encoder.save(destination)


def box(box_type: bytes, payload: bytes) -> bytes:
    return struct.pack(">I4s", 8 + len(payload), box_type) + payload


def with_over_limit_width(baseline: bytes) -> bytes:
    mutated = bytearray(baseline)
    type_offset = baseline.find(b"ispe")
    if type_offset < 4 or type_offset + 16 > len(baseline):
        raise RuntimeError("Generated HEIC does not contain the expected ispe property")
    width_offset = type_offset + 8  # type + FullBox version/flags
    mutated[width_offset : width_offset + 4] = struct.pack(">I", 8_193)
    return bytes(mutated)


def with_external_data_reference(baseline: bytes) -> bytes:
    mutated = bytearray(baseline)
    type_offset = baseline.find(b"iloc")
    if type_offset < 4 or type_offset + 16 > len(baseline):
        raise RuntimeError("Generated HEIC does not contain the expected iloc box")
    payload = type_offset + 4
    version = baseline[payload]
    position = payload + 6  # FullBox + offset/length and base/index size bytes
    if version < 2:
        item_count = struct.unpack_from(">H", baseline, position)[0]
        position += 2
        item_id_bytes = 2
    else:
        item_count = struct.unpack_from(">I", baseline, position)[0]
        position += 4
        item_id_bytes = 4
    if item_count < 1:
        raise RuntimeError("Generated HEIC iloc has no items")
    position += item_id_bytes
    if version in (1, 2):
        position += 2  # construction method
    mutated[position : position + 2] = b"\0\1"
    return bytes(mutated)


def write_hash_manifest(files: list[Path]) -> None:
    lines = [f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}" for path in sorted(files)]
    (ROOT / "fixtures.sha256").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    require_pinned_host_encoder()
    image = source_pixels()
    source = ROOT / "source-grid.png"
    baseline = ROOT / "baseline.heic"
    rotated = ROOT / "irot-90-cw.heic"
    image.save(source, format="PNG", optimize=False, compress_level=9)
    encode_heic(image, baseline)
    encode_heic(image, rotated, orientation=6)

    baseline_bytes = baseline.read_bytes()
    truncated = ROOT / "truncated-ftyp.bin"
    overflow = ROOT / "overflow-ftyp.bin"
    avif = ROOT / "avif-brand.bin"
    over_limit = ROOT / "over-limit-dimension.heic"
    external_reference = ROOT / "external-reference.heic"
    truncated.write_bytes(baseline_bytes[:12])
    overflow.write_bytes(struct.pack(">I4sQ", 1, b"ftyp", 0x7FFF_FFFF_FFFF_FFFF))
    avif.write_bytes(box(b"ftyp", b"avif" + b"\0\0\0\0" + b"mif1"))
    over_limit.write_bytes(with_over_limit_width(baseline_bytes))
    external_reference.write_bytes(with_external_data_reference(baseline_bytes))
    write_hash_manifest([source, baseline, rotated, truncated, overflow, avif, over_limit, external_reference])


if __name__ == "__main__":
    main()
