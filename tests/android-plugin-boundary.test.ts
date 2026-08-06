import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("Capacitor sync never registers the community SQLite bridge in the WebView", () => {
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
  assert.doesNotMatch(
    mainActivity,
    /CapacitorSQLitePlugin|registerPlugin\(CapacitorSQLite/,
    "the activity must not bypass the generated registry by manually registering the raw SQLite plugin",
  );
});

test("SQLCipher remains an Android-only Gradle dependency after Capacitor sync", () => {
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
  assert.match(settings, /hongtai-community-sqlite-native/);
  assert.match(appBuild, /project\(":hongtai-community-sqlite-native"\)/);
});
