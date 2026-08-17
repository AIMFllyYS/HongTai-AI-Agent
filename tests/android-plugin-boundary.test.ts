import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { inflateSync } from "node:zlib";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("the standalone APK registers only its explicit custom plugins and official App lifecycle plugin", () => {
  const config = read("capacitor.config.ts");
  const mainActivity = read("android/app/src/main/java/com/hongtai/aiagent/MainActivity.kt");
  const generatedRegistry = JSON.parse(read("android/app/src/main/assets/capacitor.plugins.json")) as Array<{
    readonly pkg?: string;
    readonly classpath?: string;
  }>;

  assert.match(
    config,
    /android:\s*\{[\s\S]*?includePlugins:\s*\[\s*"@capacitor\/app"\s*\]/,
    "the Android plugin allowlist must include only the official lifecycle plugin",
  );
  assert.match(
    config,
    /android:\s*\{[\s\S]*?minWebViewVersion:\s*89[\s\S]*?minHuaweiWebViewVersion:\s*10[\s\S]*?includePlugins:\s*\[\s*"@capacitor\/app"\s*\]/,
    "WebView compatibility floors and lifecycle plugin discovery must coexist in one Android config",
  );
  assert.doesNotMatch(
    config,
    /plugins:\s*\{[\s\S]*?CapacitorSQLite/,
    "the raw SQLite plugin must not have a WebView configuration",
  );
  assert.equal(
    generatedRegistry.some(
      (entry) => entry.pkg === "@capacitor-community/sqlite" || entry.classpath?.includes("CapacitorSQLite"),
    ),
    false,
    "the generated Capacitor registry must not expose raw SQL, encryption-secret, or delete-database methods",
  );
  assert.deepEqual(
    generatedRegistry,
    [{ pkg: "@capacitor/app", classpath: "com.capacitorjs.plugins.app.AppPlugin" }],
    "the generated registry must expose only the official App lifecycle plugin",
  );
  for (const plugin of ["SecureSettingsPlugin", "LocalDataPlugin", "LocalFilesPlugin", "NativeNetworkPlugin", "FileMediaPlugin", "MediaRuntimePlugin", "ProductionRuntimePlugin"]) {
    assert.match(mainActivity, new RegExp(`registerPlugin\\(${plugin}::class\\.java\\)`));
  }
  assert.match(mainActivity, /import androidx\.media3\.common\.util\.UnstableApi/);
  assert.match(mainActivity, /@UnstableApi\s*\r?\n\s*override fun onCreate/);
  assert.doesNotMatch(mainActivity, /CapacitorSQLitePlugin|TaskStorePlugin|AnalysisStorePlugin|DiagnosisStorePlugin|TaskRuntimePlugin|TaskRecoveryRegistry|LocalEncryptedStorage/);
});

test("the standalone APK has no SQLite or SQLCipher build dependency", () => {
  const rootPackage = JSON.parse(read("package.json")) as {
    readonly devDependencies?: Readonly<Record<string, string>>;
  };
  const webPackage = JSON.parse(read("apps/web/package.json")) as {
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  const settings = read("android/settings.gradle.kts");
  const appBuild = read("android/app/build.gradle.kts");

  assert.equal(
    webPackage.dependencies?.["@capacitor-community/sqlite"],
    undefined,
    "the React application must not import the community raw-SQL bridge",
  );
  assert.equal(rootPackage.devDependencies?.["@capacitor-community/sqlite"], undefined);
  assert.doesNotMatch(settings, /sqlite|sqlcipher/i);
  assert.doesNotMatch(appBuild, /sqlite|sqlcipher/i);
});

test("camera capture declares package visibility and cleans up unavailable launches", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const fileMedia = read("android/app/src/main/java/com/hongtai/aiagent/bridge/FileMediaPlugin.kt");

  for (const permission of [
    "android.permission.CAMERA",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.MANAGE_EXTERNAL_STORAGE",
  ]) {
    assert.doesNotMatch(manifest, new RegExp(permission.replaceAll(".", "\\.")));
  }
  assert.match(manifest, /<queries>[\s\S]*android\.media\.action\.IMAGE_CAPTURE[\s\S]*<\/queries>/);
  assert.match(manifest, /android:name="androidx\.core\.content\.FileProvider"[\s\S]*android:exported="false"[\s\S]*android:grantUriPermissions="true"/);
  assert.match(fileMedia, /MediaStore\.ACTION_IMAGE_CAPTURE/);
  assert.match(fileMedia, /FLAG_GRANT_READ_URI_PERMISSION or Intent\.FLAG_GRANT_WRITE_URI_PERMISSION/);
  assert.match(fileMedia, /MediaStore\.ACTION_PICK_IMAGES/);
  assert.match(fileMedia, /Intent\.ACTION_OPEN_DOCUMENT/);
  assert.match(fileMedia, /ActivityNotFoundException/);
  assert.match(fileMedia, /catch\s*\(error:\s*ActivityNotFoundException\)[\s\S]*discardCapture\(capture\)/);
});

test("photo activity callbacks persist recovery state and dispatch heavy import to one native executor", () => {
  const fileMedia = read("android/app/src/main/java/com/hongtai/aiagent/bridge/FileMediaPlugin.kt");

  assert.match(fileMedia, /PhotoOperationStateStore/);
  assert.match(fileMedia, /override fun load\(\)[\s\S]*resumePersistedImport/);
  assert.match(fileMedia, /PluginCall\.CALLBACK_ID_DANGLING/);
  assert.match(fileMedia, /fun consumePhotoOperation\(call: PluginCall\)/);
  assert.match(fileMedia, /PHOTO_IMPORT_EXECUTOR\s*=\s*Executors\.newSingleThreadExecutor/);
  assert.match(fileMedia, /PHOTO_IMPORT_EXECUTOR\.execute\s*\{/);

  const pickerCallback = fileMedia.match(/private fun onPhotoPicked[\s\S]*?\n {2}}\n\n {2}@ActivityCallback/)?.[0] ?? "";
  const captureCallback = fileMedia.match(/private fun onPhotoCaptured[\s\S]*?\n {2}}\n\n {2}@PluginMethod/)?.[0] ?? "";
  assert.doesNotMatch(pickerCallback, /mediaStore\.importFrom|BitmapFactory|FileOutputStream/);
  assert.doesNotMatch(captureCallback, /mediaStore\.importCaptured|BitmapFactory|FileOutputStream/);
});

test("a resumed activity terminates a photo operation whose external result was lost", () => {
  const fileMedia = read("android/app/src/main/java/com/hongtai/aiagent/bridge/FileMediaPlugin.kt");

  assert.match(
    fileMedia,
    /override fun handleOnResume\(\)[\s\S]*PhotoOperationAwaitingResult[\s\S]*PHOTO_RECOVERY_FAILED/,
    "an awaiting operation must become an explicit retryable terminal when Android resumes without its result callback",
  );
});

test("picker recovery retains the granted read URI permission until the private copy reaches a terminal", () => {
  const fileMedia = read("android/app/src/main/java/com/hongtai/aiagent/bridge/FileMediaPlugin.kt");
  const pickerStart = fileMedia.indexOf("private fun onPhotoPicked");
  const pickerCallback = fileMedia.slice(pickerStart, fileMedia.indexOf("@ActivityCallback", pickerStart));
  const importStart = fileMedia.indexOf("private fun submitImport");
  const importWorker = fileMedia.slice(importStart, fileMedia.indexOf("private fun importAndResolve", importStart));

  assert.match(pickerCallback, /persistPickerReadPermission\(sourceUri\)[\s\S]*markPickerImporting/);
  assert.match(
    pickerCallback,
    /if \(importing == null\) \{\s*releasePickerReadPermission\(sourceUri\.toString\(\)\)\s*finishFailure/,
    "a failed state transition after a granted picker URI must not leak its persistent read permission",
  );
  assert.match(fileMedia, /private fun persistPickerReadPermission[\s\S]*takePersistableUriPermission\(sourceUri, Intent\.FLAG_GRANT_READ_URI_PERMISSION\)/);
  assert.match(importWorker, /finally\s*\{[\s\S]*releasePickerReadPermission\(operation\.sourceUri\)[\s\S]*scheduledOperations\.remove/);
  assert.match(fileMedia, /private fun releasePickerReadPermission[\s\S]*releasePersistableUriPermission\([^,]+, Intent\.FLAG_GRANT_READ_URI_PERMISSION\)/);
});

test("lost camera callbacks discard only the constrained staging capture before recovery failure", () => {
  const fileMedia = read("android/app/src/main/java/com/hongtai/aiagent/bridge/FileMediaPlugin.kt");
  const resumeStart = fileMedia.indexOf("override fun handleOnResume");
  const resume = fileMedia.slice(resumeStart, fileMedia.indexOf("@PluginMethod", resumeStart));

  assert.match(resume, /awaiting\.kind == PhotoOperationKind\.CAPTURE/);
  assert.match(resume, /awaiting\.captureFileName\?\.let\(mediaStore::restorePhotoCapture\)\?\.let\(mediaStore::discardCapture\)/);
  assert.ok(
    resume.indexOf("discardCapture") < resume.indexOf("finishFailure"),
    "camera staging data must be discarded before the operation becomes an unrecoverable failure",
  );
});

test("native downloads forward bounded real byte progress to the shared pipeline", () => {
  const plugin = read("android/app/src/main/java/com/hongtai/aiagent/bridge/NativeNetworkPlugin.kt");
  const client = read("android/app/src/main/java/com/hongtai/aiagent/network/NativeDownloadClient.kt");

  assert.match(client, /onProgress:\s*\(\(NativeDownloadProgress\)\s*->\s*Unit\)\?/);
  assert.match(client, /onBytesWritten\s*=\s*\{\s*written/);
  assert.match(plugin, /notifyListeners\(\s*"downloadProgress"/);
  assert.match(plugin, /\.put\("downloadedBytes"/);
  assert.match(plugin, /\.putOptional\("totalBytes"/);
  assert.match(plugin, /\.putOptional\("progress"/);
});

test("native page fetches reject with stable link codes and allowlisted data without logging Throwable details", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const plugin = read("android/app/src/main/java/com/hongtai/aiagent/bridge/NativeNetworkPlugin.kt");
  const fetchClient = read("android/app/src/main/java/com/hongtai/aiagent/network/NativeTextFetchClient.kt");
  const issueCodes = read("android/app/src/main/java/com/hongtai/aiagent/bridge/NativeIssueCode.kt");
  const fetchMethod = plugin.slice(plugin.indexOf("fun fetchText"), plugin.indexOf("fun download"));

  for (const code of [
    "ERR_LINK_DNS_FAILED",
    "ERR_LINK_TLS_FAILED",
    "ERR_LINK_CONNECTION_FAILED",
    "ERR_LINK_TIMEOUT",
    "ERR_LINK_REDIRECT_LIMIT",
    "ERR_LINK_REDIRECT_INVALID",
    "ERR_LINK_RESPONSE_TOO_LARGE",
    "ERR_LINK_RESPONSE_INVALID",
    "ERR_LINK_RESPONSE_FAILED",
    "ERR_LINK_REQUEST_INVALID",
  ]) {
    assert.match(issueCodes, new RegExp(code));
  }
  assert.match(fetchClient, /NativeLinkFailureClassifier\.classify/);
  assert.doesNotMatch(fetchClient, /PAGE_FETCH_/);
  assert.match(fetchMethod, /call\.reject\(error\.userMessage, error\.code, error\.diagnostic\?\.toJsObject\(\)\)/);
  assert.doesNotMatch(fetchMethod, /call\.reject\([^\n]*,\s*error\)/);
  assert.doesNotMatch(manifest, /ACCESS_NETWORK_STATE/);
});

test("the foreground APK keeps the screen awake while its in-process tasks are active", () => {
  const mainActivity = read("android/app/src/main/java/com/hongtai/aiagent/MainActivity.kt");

  assert.match(mainActivity, /WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON/);
  assert.match(mainActivity, /window\.addFlags\(/);
});

test("video production returns stable safe errors and exports an AAC audio track", () => {
  const plugin = read("android/app/src/main/java/com/hongtai/aiagent/bridge/ProductionRuntimePlugin.kt");
  const renderer = read("android/app/src/main/java/com/hongtai/aiagent/production/ProductionRenderer.kt");
  const classifier = read("android/app/src/main/java/com/hongtai/aiagent/production/ProductionExportFailureClassifier.kt");
  const failureKinds = read("android/app/src/main/java/com/hongtai/aiagent/production/ProductionFailure.kt");
  const cloudTts = read("android/app/src/main/java/com/hongtai/aiagent/production/CloudNarrationSynthesizer.kt");
  const issueCodes = read("android/app/src/main/java/com/hongtai/aiagent/bridge/NativeIssueCode.kt");

  for (const code of [
    "MEDIA_SELECTION_CANCELLED",
    "MEDIA_SOURCE_INVALID",
    "TTS_UNAVAILABLE",
    "TTS_SYNTHESIS_FAILED",
    "MEDIA_RENDER_TIMEOUT",
    "MEDIA_ENCODER_UNAVAILABLE",
    "MEDIA_DECODE_FAILED",
    "MEDIA_RENDER_PIPELINE_FAILED",
    "MEDIA_OUTPUT_INVALID",
    "MEDIA_EXPORT_FAILED",
    "OUTPUT_FINALIZATION_FAILED",
  ]) assert.match(issueCodes, new RegExp(code));
  for (const code of [
    "MEDIA_SOURCE_INVALID",
    "TTS_UNAVAILABLE",
    "TTS_SYNTHESIS_FAILED",
    "MEDIA_RENDER_TIMEOUT",
    "MEDIA_ENCODER_UNAVAILABLE",
    "MEDIA_DECODE_FAILED",
    "MEDIA_RENDER_PIPELINE_FAILED",
    "MEDIA_OUTPUT_INVALID",
    "MEDIA_EXPORT_FAILED",
    "OUTPUT_FINALIZATION_FAILED",
  ]) assert.match(failureKinds, new RegExp(code));
  assert.match(plugin, /ProductionFailureKind\.MEDIA_ENCODER_UNAVAILABLE -> NativeIssueCode\.MEDIA_ENCODER_UNAVAILABLE/);
  assert.match(plugin, /ProductionFailureKind\.MEDIA_DECODE_FAILED -> NativeIssueCode\.MEDIA_DECODE_FAILED/);
  assert.match(plugin, /ProductionFailureKind\.MEDIA_RENDER_PIPELINE_FAILED -> NativeIssueCode\.MEDIA_RENDER_PIPELINE_FAILED/);
  assert.match(plugin, /ProductionFailureKind\.MEDIA_OUTPUT_INVALID -> NativeIssueCode\.MEDIA_OUTPUT_INVALID/);
  assert.match(plugin, /call\.reject\("Production asset selection was cancelled\."\s*,\s*NativeIssueCode\.MEDIA_SELECTION_CANCELLED\)/);
  assert.doesNotMatch(plugin, /call\.reject\([^\n]*,\s*error\)/);
  assert.match(renderer, /setAudioMimeType\(MimeTypes\.AUDIO_AAC\)/);
  assert.match(renderer, /setVideoMimeType\(MimeTypes\.VIDEO_H264\)/);
  assert.match(renderer, /setEnableFallback\(false\)/);
  assert.match(renderer, /setVideoEncoderSelector\(h264EncoderSelector/);
  assert.match(renderer, /EncoderUtil\.getSupportedEncoders/);
  assert.match(renderer, /shouldRetryWithSoftware/);
  assert.doesNotMatch(renderer, /VIDEO_H265|VIDEO_HEVC|MimeTypes\.VIDEO_H265/);
  assert.match(classifier, /MEDIA_ENCODER_UNAVAILABLE/);
  assert.match(classifier, /MEDIA_DECODE_FAILED/);
  assert.match(classifier, /MEDIA_RENDER_PIPELINE_FAILED/);
  assert.match(classifier, /MEDIA_OUTPUT_INVALID/);
  const verification = renderer.indexOf("val durationSeconds = verifyOutput(temporary)");
  const finalization = renderer.indexOf("finalizeOutput(temporary, output)");
  assert.ok(verification >= 0 && verification < finalization, "the temporary MP4 must pass H.264/AAC verification before an existing output is replaced");
  assert.match(renderer, /MimeTypes\.VIDEO_H264 !in mimes/);
  assert.match(renderer, /MimeTypes\.AUDIO_AAC !in mimes/);
  assert.match(renderer, /MEDIA_RENDER_TIMEOUT/);
  assert.match(plugin, /fun probeTts\(call: PluginCall\)/);
  assert.match(plugin, /CloudNarrationSynthesizer/);
  assert.match(cloudTts, /AndroidKeystoreSecretStore/);
  assert.match(cloudTts, /NativeNetworkPolicy/);
  assert.match(cloudTts, /temporary\.delete\(\)/);
  const cloudSegment = cloudTts.slice(cloudTts.indexOf("private fun synthesizeShot"), cloudTts.indexOf("private fun writeAudio"));
  assert.match(cloudSegment, /finalizeNarrationSegment\(temporary, output\)/);
  assert.doesNotMatch(cloudSegment, /output\.exists\(\) && !output\.delete\(\)/);
  assert.doesNotMatch(cloudTts, /Log\.|notifyListeners\(/);
});

test("client APK builds are identifiable and never log bridge payloads", () => {
  const config = read("capacitor.config.ts");
  const appBuild = read("android/app/build.gradle.kts");

  assert.match(config, /loggingBehavior:\s*"none"/);
  assert.match(appBuild, /versionCode\s*=\s*[1-9][0-9]*/);
  assert.doesNotMatch(appBuild, /versionName\s*=\s*"0\.1\.0"/);
});

const WEB_BRAND_ICON_SHA256 = "b7666580d788a694be1a331f4dac36aebfb06b1000190cef6eb542bb49afceac";
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

type DecodedPng = {
  readonly width: number;
  readonly height: number;
  readonly colorType: number;
  readonly pixels: Uint8Array;
};

const paethPredictor = (left: number, up: number, upperLeft: number) => {
  const estimate = left + up - upperLeft;
  const leftDist = Math.abs(estimate - left);
  const upDist = Math.abs(estimate - up);
  const upperLeftDist = Math.abs(estimate - upperLeft);
  if (leftDist <= upDist && leftDist <= upperLeftDist) {
    return left;
  }
  return upDist <= upperLeftDist ? up : upperLeft;
};

const readPng = (buffer: Buffer): DecodedPng => {
  assert.deepEqual([...buffer.subarray(0, 8)], PNG_SIGNATURE, "icon assets must stay PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  assert.equal(bitDepth, 8, "launcher PNGs must be 8-bit");
  assert.ok(colorType === 2 || colorType === 6, "launcher PNGs must be RGB or RGBA");
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bytesPerPixel;
  const pixels = new Uint8Array(width * height * 4);
  const previous = new Uint8Array(stride);
  const row = new Uint8Array(stride);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source] ?? 0;
    source += 1;
    for (let index = 0; index < stride; index += 1) {
      const value = raw[source + index] ?? 0;
      const left = index >= bytesPerPixel ? (row[index - bytesPerPixel] ?? 0) : 0;
      const up = previous[index] ?? 0;
      const upperLeft = index >= bytesPerPixel ? (previous[index - bytesPerPixel] ?? 0) : 0;
      let reconstructed = value;
      if (filter === 1) {
        reconstructed = (value + left) & 255;
      } else if (filter === 2) {
        reconstructed = (value + up) & 255;
      } else if (filter === 3) {
        reconstructed = (value + ((left + up) >> 1)) & 255;
      } else if (filter === 4) {
        reconstructed = (value + paethPredictor(left, up, upperLeft)) & 255;
      } else {
        assert.equal(filter, 0, "PNG filter must be 0-4");
      }
      row[index] = reconstructed;
    }
    source += stride;
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = x * bytesPerPixel;
      const destIndex = (y * width + x) * 4;
      pixels[destIndex] = row[sourceIndex] ?? 0;
      pixels[destIndex + 1] = row[sourceIndex + 1] ?? 0;
      pixels[destIndex + 2] = row[sourceIndex + 2] ?? 0;
      pixels[destIndex + 3] = colorType === 6 ? (row[sourceIndex + 3] ?? 0) : 255;
    }
    previous.set(row);
  }
  return { width, height, colorType, pixels };
};

const isNearWhite = (red: number, green: number, blue: number, alpha = 255) => {
  if (alpha < 200) {
    return false;
  }
  const min = Math.min(red, green, blue);
  const saturation = Math.max(red, green, blue) - min;
  return min >= 230 && saturation <= 25;
};

const opaqueBounds = (image: DecodedPng, alphaThreshold = 16) => {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let transparent = 0;
  let opaque = 0;
  let keptNearWhite = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * 4;
      const alpha = image.pixels[index + 3] ?? 0;
      if (alpha <= alphaThreshold) {
        transparent += 1;
        continue;
      }
      opaque += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (isNearWhite(image.pixels[index] ?? 0, image.pixels[index + 1] ?? 0, image.pixels[index + 2] ?? 0, alpha)) {
        keptNearWhite += 1;
      }
    }
  }
  return { minX, minY, maxX, maxY, transparent, opaque, keptNearWhite };
};

test("release candidate v0.1.15 keeps the HongTai brand source and ships an adaptive launcher icon", () => {
  const appBuild = read("android/app/build.gradle.kts");
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const adaptive = read("android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml");
  const adaptiveRound = read("android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml");
  const background = read("android/app/src/main/res/drawable/ic_launcher_background.xml");
  const sourcePath = join(root, "apps/web/public/brand/hongtai-app-icon.png");
  const foregroundPath = join(root, "android/app/src/main/res/drawable-nodpi/ic_launcher_foreground.png");
  const legacyPath = join(root, "android/app/src/main/res/mipmap-nodpi/ic_launcher.png");
  const sourceBytes = readFileSync(sourcePath);
  const source = readPng(sourceBytes);
  const foreground = readPng(readFileSync(foregroundPath));
  const legacy = readPng(readFileSync(legacyPath));
  const bounds = opaqueBounds(foreground);
  const inset = (foreground.width * 21) / 108;

  assert.match(appBuild, /versionCode\s*=\s*23\b/);
  assert.match(appBuild, /versionName\s*=\s*"0\.1\.15"/);
  assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), WEB_BRAND_ICON_SHA256, "the public brand PNG remains the cropped source");
  assert.equal(source.colorType, 2, "the web brand source stays an opaque RGB canvas");
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  assert.match(adaptive, /<adaptive-icon[\s\S]*<background\s+android:drawable="@drawable\/ic_launcher_background"/);
  assert.match(adaptive, /<foreground\s+android:drawable="@drawable\/ic_launcher_foreground"/);
  assert.match(adaptiveRound, /<adaptive-icon[\s\S]*<background\s+android:drawable="@drawable\/ic_launcher_background"/);
  assert.match(adaptiveRound, /<foreground\s+android:drawable="@drawable\/ic_launcher_foreground"/);
  assert.match(background, /<gradient[\s\S]*android:startColor=/);
  assert.doesNotMatch(background, /#(F{3}|F{6}|[Ff]{3}|[Ff]{6})\b/);
  assert.equal(foreground.colorType, 6, "adaptive foreground must be a layered RGBA asset");
  assert.ok(bounds.transparent > 0, "adaptive foreground must have knocked-out alpha");
  assert.ok(bounds.opaque > 0, "adaptive foreground must keep the brand artwork");
  assert.ok(bounds.keptNearWhite > 1000, "white helmet and 宏泰AI glyphs must survive knockout");
  assert.ok(bounds.minX >= inset - 1 && bounds.minY >= inset - 1, "artwork must stay inside the 66/108 safe zone");
  assert.ok(bounds.maxX <= foreground.width - inset + 1 && bounds.maxY <= foreground.height - inset + 1, "artwork must not spill outside the 66/108 safe zone");
  assert.equal(existsSync(legacyPath), true, "API 24-25 still needs a leftover launcher bitmap");
  assert.notDeepEqual(readFileSync(legacyPath), sourceBytes, "Android bitmaps are no longer a byte-identical copy of the white-canvas web source");
  const midX = Math.floor(legacy.width / 2);
  const midY = Math.floor(legacy.height / 2);
  const edgePixels = [
    [midX, 0],
    [midX, legacy.height - 1],
    [0, midY],
    [legacy.width - 1, midY],
  ] as const;
  for (const [x, y] of edgePixels) {
    const index = (y * legacy.width + x) * 4;
    assert.equal(
      isNearWhite(legacy.pixels[index] ?? 0, legacy.pixels[index + 1] ?? 0, legacy.pixels[index + 2] ?? 0, legacy.pixels[index + 3] ?? 0),
      false,
      `legacy bitmap edge ${x},${y} must not keep a white seam`,
    );
  }
});
