import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const windowsOnly =
  process.platform === "win32" ? false : "Windows-only signing behavior";

function windowsAndroidEnvironment(): NodeJS.ProcessEnv {
  const javaHome =
    process.env.JAVA_HOME ??
    join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Android",
      "Android Studio",
      "jbr",
    );
  const androidSdk =
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
  assert.equal(existsSync(join(javaHome, "bin", "java.exe")), true);
  assert.equal(existsSync(join(androidSdk, "build-tools")), true);

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidSdk,
    ANDROID_SDK_ROOT: androidSdk,
  };
  delete environment.HONGTAI_RELEASE_SIGNING_PROPERTIES;
  return environment;
}

function runGradle(tasks: string[], environment = windowsAndroidEnvironment()) {
  return spawnSync(
    "cmd.exe",
    ["/d", "/s", "/c", "gradlew.bat", ...tasks, "--dry-run", "--no-daemon"],
    {
      cwd: join(root, "android"),
      encoding: "utf8",
      env: environment,
    },
  );
}

function commandOutput(result: ReturnType<typeof spawnSync>): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

test("release builds require an external non-Debug signing identity", () => {
  const gradle = read("android/app/build.gradle.kts");
  const androidIgnore = read("android/.gitignore");
  const rootIgnore = read(".gitignore");

  assert.match(gradle, /HONGTAI_RELEASE_SIGNING_PROPERTIES/);
  assert.match(gradle, /signingConfigs\s*\{[\s\S]*create\("release"\)/);
  assert.match(
    gradle,
    /release\s*\{[\s\S]*signingConfig\s*=\s*signingConfigs\.findByName\("release"\)/,
  );
  assert.match(
    gradle,
    /gradle\.taskGraph\.whenReady\s*\(\s*object\s*:\s*Action<TaskExecutionGraph>/,
  );
  assert.match(gradle, /graph\.allTasks\.any/);
  for (const taskName of [
    "assembleRelease",
    "bundleRelease",
    "packageRelease",
    "packageReleaseBundle",
    "packageReleaseUniversalApk",
    "signReleaseBundle",
    "installRelease",
    "validateSigningRelease",
  ]) {
    assert.match(gradle, new RegExp(`"${taskName}"`));
  }
  assert.match(gradle, /task\.name\s+in\s+releaseArtifactTaskNames/);
  assert.doesNotMatch(gradle, /task\.name\.contains\("Release"/);
  assert.doesNotMatch(gradle, /task\.name\.startsWith\(operation/);
  assert.doesNotMatch(gradle, /gradle\.startParameter\.taskNames/);
  assert.match(
    gradle,
    /GradleException\("Release signing configuration is required/,
  );
  assert.match(gradle, /canonicalFile/);
  assert.match(gradle, /isInsideRepository/);
  assert.match(gradle, /Files\.isSymbolicLink/);
  assert.match(gradle, /toRealPath/);
  assert.match(gradle, /pathTraversesReparsePoint\(releaseSigningFile\)/);
  assert.match(gradle, /pathTraversesReparsePoint\(keyStore\)/);
  assert.match(gradle, /enableV1Signing\s*=\s*false/);
  assert.match(gradle, /enableV2Signing\s*=\s*true/);
  assert.match(gradle, /enableV3Signing\s*=\s*true/);
  assert.match(gradle, /alias\.equals\("androiddebugkey",\s*ignoreCase\s*=\s*true\)/);
  assert.doesNotMatch(gradle, /signingConfigs\.debug|debug\.keystore/i);
  assert.match(androidIgnore, /^\/keystore\.properties$/m);
  assert.match(androidIgnore, /^\/\*\.jks$/m);
  assert.match(androidIgnore, /^\/\*\.keystore$/m);
  assert.match(androidIgnore, /^\/\*\.p12$/m);
  assert.match(rootIgnore, /^\*\.jks$/m);
  assert.match(rootIgnore, /^\*\.keystore$/m);
  assert.match(rootIgnore, /^\*\.p12$/m);
  assert.match(rootIgnore, /^keystore\.properties$/m);
});

test("release tooling verifies the anchored certificate and signed APK", () => {
  for (const path of [
    "android/keystore.properties.example",
    "android/release-certificate.sha256",
    "scripts/init-android-release-signing.ps1",
    "scripts/build-android-release.ps1",
  ]) {
    assert.equal(existsSync(join(root, path)), true, `${path} must exist`);
  }

  const init = read("scripts/init-android-release-signing.ps1");
  const build = read("scripts/build-android-release.ps1");
  assert.match(init, /RandomNumberGenerator/);
  assert.match(init, /-storepass:env/);
  assert.match(init, /-keypass:env/);
  assert.match(init, /already exists/);
  assert.match(init, /Resolve-CanonicalPath/);
  assert.match(init, /Test-PathInsideRepository/);
  assert.match(init, /Assert-NoReparsePoint/);
  assert.match(init, /FileAttributes.*ReparsePoint/);
  assert.match(
    init,
    /Assert-NoReparsePoint\s+-Path\s+\$SigningDirectory/,
  );
  assert.match(build, /Resolve-CanonicalPath/);
  assert.match(build, /Test-PathInsideRepository/);
  assert.match(build, /Assert-NoReparsePoint/);
  assert.match(build, /FileAttributes.*ReparsePoint/);
  assert.match(build, /Assert-NoReparsePoint\s+-Path\s+\$SigningProperties/);
  assert.doesNotMatch(build, /VerifyExistingApk/);
  assert.match(
    init,
    /try\s*\{\s*\$storePassword\s*=\s*New-RandomSecret\s*\$keyPassword\s*=\s*New-RandomSecret/,
  );
  assert.match(
    init,
    /finally\s*\{[\s\S]*\$properties\s*=\s*\$null[\s\S]*\$storePassword\s*=\s*\$null[\s\S]*\$keyPassword\s*=\s*\$null/,
  );
  assert.doesNotMatch(init + build, /debug\.keystore/);
  assert.match(build, /zipalign/);
  assert.match(build, /aapt2/);
  assert.match(build, /apksigner/);
  assert.match(build, /Verified using v2 scheme[\s\S]*true/);
  assert.match(build, /Verified using v3 scheme[\s\S]*true/);
  assert.match(build, /Android Debug/);
  assert.match(build, /release-certificate\.sha256/);
  assert.match(build, /Get-FileHash[\s\S]*SHA256/);
});

test(
  "Windows task graph gates release artifacts without blocking checks",
  { skip: windowsOnly },
  () => {
    for (const taskName of [
      ":app:packageReleaseBundle",
      ":app:packageReleaseUniversalApk",
      ":app:signReleaseBundle",
    ]) {
      const terminalArtifact = runGradle([taskName]);
      assert.equal(terminalArtifact.error, undefined);
      assert.notEqual(terminalArtifact.status, 0, taskName);
      assert.match(
        commandOutput(terminalArtifact),
        /Release signing configuration is required via HONGTAI_RELEASE_SIGNING_PROPERTIES/,
      );
    }

    const nonArtifacts = runGradle([
      ":app:testReleaseUnitTest",
      ":app:assembleUnitTest",
      ":app:lintRelease",
      ":app:packageReleaseResources",
    ]);
    assert.equal(nonArtifacts.error, undefined);
    assert.equal(nonArtifacts.status, 0, commandOutput(nonArtifacts));
    assert.doesNotMatch(
      commandOutput(nonArtifacts),
      /Release signing configuration is required/,
    );
  },
);

test(
  "Windows signing entrypoints reject a repository junction alias",
  { skip: windowsOnly },
  () => {
    const repositoryPath = realpathSync(root);
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "hongtai-release-signing-junction-"),
    );
    const fixturePath = realpathSync(fixtureRoot);
    assert.notEqual(
      fixturePath.toLowerCase().startsWith(
        `${repositoryPath.toLowerCase().replace(/[\\/]+$/, "")}${sep}`,
      ),
      true,
    );

    const repositoryJunction = join(fixtureRoot, "repo-link");
    const externalProperties = join(fixtureRoot, "external.properties");
    const targetLeaf = `.issue05-junction-init-${fixtureRoot.slice(-8)}`;
    const repositoryInitTarget = join(root, targetLeaf);
    const junctionInitTarget = join(repositoryJunction, targetLeaf);
    assert.equal(existsSync(repositoryInitTarget), false);

    try {
      symlinkSync(repositoryPath, repositoryJunction, "junction");
      writeFileSync(
        externalProperties,
        [
          `storeFile=${join(
            repositoryJunction,
            "android",
            "keystore.properties.example",
          ).replaceAll("\\", "/")}`,
          "storePassword=placeholder-only",
          "keyAlias=placeholder-only",
          "keyPassword=placeholder-only",
          "",
        ].join("\n"),
        "utf8",
      );

      const init = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          join(root, "scripts", "init-android-release-signing.ps1"),
          "-SigningDirectory",
          junctionInitTarget,
        ],
        { cwd: root, encoding: "utf8", env: process.env },
      );
      assert.equal(init.error, undefined);
      assert.notEqual(init.status, 0);
      assert.match(commandOutput(init), /must not traverse a reparse point/);
      assert.equal(existsSync(repositoryInitTarget), false);

      const build = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          join(root, "scripts", "build-android-release.ps1"),
          "-SigningProperties",
          join(repositoryJunction, "android", "keystore.properties.example"),
        ],
        { cwd: root, encoding: "utf8", env: process.env },
      );
      assert.equal(build.error, undefined);
      assert.notEqual(build.status, 0);
      assert.match(commandOutput(build), /must not traverse a reparse point/);

      const gradleEnvironment = windowsAndroidEnvironment();
      gradleEnvironment.HONGTAI_RELEASE_SIGNING_PROPERTIES = externalProperties;
      const gradle = runGradle([":app:assembleRelease"], gradleEnvironment);
      assert.equal(gradle.error, undefined);
      assert.notEqual(gradle.status, 0);
      assert.match(
        commandOutput(gradle),
        /Release signing keystore must not traverse a reparse point/,
      );
      assert.equal(existsSync(repositoryInitTarget), false);
    } finally {
      if (existsSync(repositoryJunction)) {
        assert.equal(lstatSync(repositoryJunction).isSymbolicLink(), true);
        rmdirSync(repositoryJunction);
      }
      if (existsSync(externalProperties)) {
        unlinkSync(externalProperties);
      }
      rmdirSync(fixtureRoot);
    }

    assert.equal(existsSync(fixtureRoot), false);
    assert.equal(existsSync(repositoryInitTarget), false);
    assert.equal(existsSync(join(root, ".git")), true);
  },
);
