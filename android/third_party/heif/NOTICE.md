# Android 7.x HEIF decoder notice

The Android 7.x fallback dynamically links unmodified `libheif` 1.23.1 and
`libde265` 1.1.1 as separate shared libraries. The APK does not contain x265,
an encoder, AV1/AVIF support, an opaque AAR, or statically linked LGPL object
files. The first-party JNI adapter remains a separate shared library.

The complete corresponding source is available from the immutable URLs and
SHA-256 values in `android/native-deps/heif-lock.json`. Run
`scripts/fetch-android-heif-sources.ps1`, then follow
`docs/Android旧系统HEIF兼容与依赖指南.md` to rebuild and replace the dynamic
libraries. No repository patch is currently applied; the locked patch-set hash
is the SHA-256 of an empty byte sequence.

The bundled license copies come directly from each pinned source archive.
Copyright notices remain in the corresponding source. Reverse engineering for
debugging a modified LGPL library is not prohibited by this distribution.

Formal distribution must publish the corresponding-source archive or maintain
a valid written-source offer with an accountable owner, contact channel and
validity period. A placeholder offer is not a releasable artifact.
