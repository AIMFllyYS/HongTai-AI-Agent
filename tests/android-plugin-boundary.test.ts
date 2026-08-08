import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("the standalone APK registers only its explicit native plugins", () => {
  const config = read("capacitor.config.ts");
  const mainActivity = read("android/app/src/main/java/com/hongtai/aiagent/MainActivity.kt");
  const generatedRegistry = JSON.parse(read("android/app/src/main/assets/capacitor.plugins.json")) as Array<{
    readonly pkg?: string;
    readonly classpath?: string;
  }>;

  assert.match(
    config,
    /android:\s*\{[\s\S]*?includePlugins:\s*\[\s*\]/,
    "the Android plugin allowlist must opt out of package auto-discovery",
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
  for (const plugin of ["SecureSettingsPlugin", "LocalDataPlugin", "LocalFilesPlugin", "NativeNetworkPlugin", "FileMediaPlugin", "MediaRuntimePlugin", "ProductionRuntimePlugin"]) {
    assert.match(mainActivity, new RegExp(`registerPlugin\\(${plugin}::class\\.java\\)`));
  }
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

  assert.match(manifest, /<queries>[\s\S]*android\.media\.action\.IMAGE_CAPTURE[\s\S]*<\/queries>/);
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

test("the foreground APK keeps the screen awake while its in-process tasks are active", () => {
  const mainActivity = read("android/app/src/main/java/com/hongtai/aiagent/MainActivity.kt");

  assert.match(mainActivity, /WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON/);
  assert.match(mainActivity, /window\.addFlags\(/);
});

test("client APK builds are identifiable and never log bridge payloads", () => {
  const config = read("capacitor.config.ts");
  const appBuild = read("android/app/build.gradle.kts");

  assert.match(config, /loggingBehavior:\s*"none"/);
  assert.match(appBuild, /versionCode\s*=\s*[1-9][0-9]*/);
  assert.doesNotMatch(appBuild, /versionName\s*=\s*"0\.1\.0"/);
});

test("release APK v0.0.1 uses the supplied Pulse Flow design icon", () => {
  const appBuild = read("android/app/build.gradle.kts");
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const sourcePath = join(root, "apps/web/public/brand/pulse-flow-source.png");
  const iconPath = join(root, "android/app/src/main/res/drawable-nodpi/pulse_flow_launcher.png");

  assert.match(appBuild, /versionCode\s*=\s*1\b/);
  assert.match(appBuild, /versionName\s*=\s*"0\.0\.1"/);
  assert.match(manifest, /android:icon="@drawable\/pulse_flow_launcher"/);
  assert.equal(existsSync(iconPath), true, "the Android launcher icon must be packaged from the design asset");
  assert.deepEqual(readFileSync(iconPath), readFileSync(sourcePath), "the launcher icon must remain the supplied design asset");
});
