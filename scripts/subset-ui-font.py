#!/usr/bin/env python3
"""Rebuild the bundled Noto Sans SC VF as a local UI glyph subset.

Keeps the public path used by foundation.css. Missing glyphs fall through
to PingFang / YaHei / sans-serif. Requires the full upstream VF as --input.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from fontTools import subset

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "apps/web/public/fonts/NotoSansSC-VF.woff2"
DEFAULT_OUTPUT = DEFAULT_INPUT
SOURCE_ROOTS = (
    ROOT / "apps/web/src",
    ROOT / "packages/core/src",
    ROOT / "packages/ai/src",
    ROOT / "packages/platforms/src",
    ROOT / "packages/capacitor-runtime/src",
)
SOURCE_SUFFIXES = {".ts", ".tsx", ".css", ".json", ".html"}
ALWAYS_RANGES = (
    range(0x20, 0x7F),
    range(0xA0, 0x100),
    range(0x2000, 0x2070),
    range(0x3000, 0x3040),
    range(0xFF00, 0xFFEF),
)


def collect_text() -> str:
    chars: set[str] = {chr(code) for span in ALWAYS_RANGES for code in span}
    for source_root in SOURCE_ROOTS:
        for path in source_root.rglob("*"):
            if not path.is_file() or path.suffix not in SOURCE_SUFFIXES:
                continue
            if ".test." in path.name:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            chars.update(text)
    return "".join(sorted(chars))


def subset_font(input_path: Path, output_path: Path, text: str) -> None:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.glyph_names = True
    options.symbol_cmap = True
    options.legacy_cmap = True
    options.notdef_glyph = True
    options.notdef_outline = True
    options.recommended_glyphs = True
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.name_languages = ["*"]
    font = subset.load_font(str(input_path), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(output_path), options)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    input_path = args.input.resolve()
    if not input_path.is_file():
        raise SystemExit(f"missing input font: {input_path}")
    text = collect_text()
    subset_font(input_path, args.output.resolve(), text)
    output_size = args.output.resolve().stat().st_size
    print(f"subset {len(text)} chars -> {args.output} ({output_size} bytes)")


if __name__ == "__main__":
    main()
