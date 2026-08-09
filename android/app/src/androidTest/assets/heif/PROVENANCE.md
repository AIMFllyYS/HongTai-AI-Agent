# Android HEIF instrumentation fixtures

Generated on 2026-08-10 from synthetic pixels created by `generator/generate_fixtures.py`. No user photo or internet media is present. The synthetic pixels and their generated derivatives are dedicated to the public domain under CC0-1.0.

Reproduction command from the repository root:

```powershell
python android/app/src/androidTest/assets/heif/generator/generate_fixtures.py
```

The generator intentionally refuses a different host stack. The recorded stack is Pillow 11.3.0, pillow-heif 1.4.0, libheif 1.23.0, x265 4.2+1-e444744, and libde265 1.1.1. These encoder components are fixture-generation tools only; they are not linked into the APK. Runtime source pins are independently recorded in `android/native-deps/heif-lock.json`.

`source-grid.png` is a 96×64 RGB image with four solid quadrants: red top-left, green top-right, blue bottom-left, and yellow bottom-right. `baseline.heic` is a single HEVC primary still at 4:4:4 and quality 95. `irot-90-cw.heic` contains the same stored pixels plus a HEIF `irot` transform (orientation 6), no EXIF block, and must decode to 64×96 with blue/red/yellow/green at output top-left/top-right/bottom-left/bottom-right.

Negative derivatives are deterministic:

- `truncated-ftyp.bin` is the first 12 bytes of `baseline.heic`.
- `overflow-ftyp.bin` declares an invalid extended-size `ftyp`.
- `avif-brand.bin` is a minimal valid `ftyp` carrying unsupported `avif` and generic `mif1` brands.
- `over-limit-dimension.heic` changes only the primary `ispe` width to 8193, one pixel beyond the fallback edge limit.
- `external-reference.heic` changes the first `iloc` item data-reference index from local (`0`) to external (`1`).

The authoritative SHA-256 values are in `fixtures.sha256`. Expected decoder behavior is success only for the two unmodified HEVC stills; malformed, AVIF, and over-limit derivatives must reach stable invalid/too-large terminal paths without leaving import temporaries.
