import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
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

function powershellFile(script: string, args: string[] = [], env = process.env) {
  return spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      ...args,
    ],
    { cwd: root, encoding: "utf8", env },
  );
}

function powershellCommand(command: string) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { cwd: root, encoding: "utf8", env: process.env },
  );
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function aclSnapshot(path: string): string {
  const result = powershellCommand(
    `$acl=Get-Acl -LiteralPath ${powershellQuote(path)}; ` +
      "$sddl=$acl.GetSecurityDescriptorSddlForm(" +
      "[System.Security.AccessControl.AccessControlSections]::All); " +
      'Write-Output ($sddl + "|" + $acl.AreAccessRulesProtected)',
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, commandOutput(result));
  return String(result.stdout).trim();
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("release builds require an external non-Debug signing identity", () => {
  const gradle = read("android/app/build.gradle.kts");
  const androidIgnore = read("android/.gitignore");
  const rootIgnore = read(".gitignore");

  assert.match(gradle, /HONGTAI_RELEASE_SIGNING_PROPERTIES/);
  assert.match(
    gradle,
    /rawReleaseSigningFile\s*=\s*releaseSigningPath\?\.let\(::File\)/,
  );
  assert.match(
    gradle,
    /rawReleaseSigningFile\s*!=\s*null\s*&&\s*!rawReleaseSigningFile\.isAbsolute/,
  );
  assert.match(
    gradle,
    /rawKeyStore\s*=\s*File\(requiredReleaseSigningValue\("storeFile"\)\)/,
  );
  assert.match(gradle, /if\s*\(!rawKeyStore\.isAbsolute\)/);
  assert.match(
    gradle,
    /releaseSigningFile\.reader\(Charsets\.UTF_8\)\.use\(releaseSigning::load\)/,
  );
  assert.doesNotMatch(
    gradle,
    /releaseSigningFile\.inputStream\(\)\.use\(releaseSigning::load\)/,
  );
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
    "scripts/android-release-signing-transaction.psm1",
  ]) {
    assert.equal(existsSync(join(root, path)), true, `${path} must exist`);
  }

  const init = read("scripts/init-android-release-signing.ps1");
  const build = read("scripts/build-android-release.ps1");
  const transaction = read("scripts/android-release-signing-transaction.psm1");
  assert.match(init, /RandomNumberGenerator/);
  assert.match(init, /-storepass:env/);
  assert.match(init, /-keypass:env/);
  assert.match(init, /already exist/);
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
  for (const script of [init, build]) {
    assert.match(
      script,
      /\$rawRepositoryRoot\s*=\s*Join-Path\s+\$PSScriptRoot\s+"\.\."[\s\S]*Assert-NoReparsePoint\s+-Path\s+\$rawRepositoryRoot[\s\S]*\$repositoryRoot\s*=\s*Resolve-CanonicalPath\s+-Path\s+\$rawRepositoryRoot/,
    );
  }
  assert.match(
    init,
    /if\s*\(Test-Path\s+-LiteralPath\s+\$resolvedSigningDirectory\)[\s\S]*must not already exist/,
  );
  assert.match(init, /android-release-signing-transaction\.psm1/);
  assert.match(init, /Publish-AndroidReleaseSigningDirectory/);
  assert.match(init, /Remove-AndroidReleaseSigningStagingDirectory/);
  assert.match(
    init,
    /-ExpectedParentDirectory\s+\$signingParentDirectory/g,
  );
  assert.doesNotMatch(init, /Move-Item/);
  assert.match(transaction, /\[System\.IO\.Directory\]::Move/);
  assert.match(transaction, /ExpectedParentDirectory/);
  assert.match(transaction, /\^\\\.signing\\\.\[0-9a-f\]\{32\}\\\.staging\$/);
  assert.match(transaction, /OrdinalIgnoreCase/);
  assert.match(transaction, /Assert-NoReparsePoint/);
  assert.match(transaction, /FileAttributes[\s\S]*ReparsePoint/);
  assert.match(transaction, /hongtai-release\.jks/);
  assert.match(transaction, /keystore\.properties/);
  assert.match(transaction, /hongtai-release\.cer/);
  assert.doesNotMatch(transaction, /Remove-Item\s+[^\r\n]*-Recurse/);
  assert.doesNotMatch(build, /VerifyExistingApk/);
  assert.match(
    init,
    /try\s*\{[\s\S]*\$storePassword\s*=\s*New-RandomSecret\s*\$keyPassword\s*=\s*New-RandomSecret/,
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
  "Windows Gradle rejects raw relative signing paths",
  { skip: windowsOnly },
  () => {
    const relativePropertiesEnvironment = windowsAndroidEnvironment();
    relativePropertiesEnvironment.HONGTAI_RELEASE_SIGNING_PROPERTIES =
      "relative-keystore.properties";
    const relativeProperties = runGradle(
      [":app:assembleRelease"],
      relativePropertiesEnvironment,
    );
    assert.equal(relativeProperties.error, undefined);
    assert.notEqual(relativeProperties.status, 0);
    assert.match(
      commandOutput(relativeProperties),
      /Release signing configuration must use an absolute path/,
    );

    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "hongtai-release-signing-relative-"),
    );
    const externalProperties = join(fixtureRoot, "external.properties");
    try {
      writeFileSync(
        externalProperties,
        [
          "storeFile=relative-release.jks",
          "storePassword=placeholder-only",
          "keyAlias=placeholder-only",
          "keyPassword=placeholder-only",
          "",
        ].join("\n"),
        "utf8",
      );
      const relativeStoreEnvironment = windowsAndroidEnvironment();
      relativeStoreEnvironment.HONGTAI_RELEASE_SIGNING_PROPERTIES =
        externalProperties;
      const relativeStore = runGradle(
        [":app:assembleRelease"],
        relativeStoreEnvironment,
      );
      assert.equal(relativeStore.error, undefined);
      assert.notEqual(relativeStore.status, 0);
      assert.match(
        commandOutput(relativeStore),
        /Release signing keystore must use an absolute path/,
      );
    } finally {
      if (existsSync(externalProperties)) {
        unlinkSync(externalProperties);
      }
      rmdirSync(fixtureRoot);
    }
  },
);

test(
  "Windows Gradle reads UTF-8 signing properties from Chinese paths",
  { skip: windowsOnly },
  () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "hongtai-release-signing-utf8-"),
    );
    const signingDirectory = join(fixtureRoot, "发布签名材料");
    const keyStore = join(signingDirectory, "宏泰发布密钥.jks");
    const properties = join(signingDirectory, "发布签名.properties");
    mkdirSync(signingDirectory);

    try {
      writeFileSync(keyStore, "placeholder-keystore", "utf8");
      writeFileSync(
        properties,
        [
          `storeFile=${keyStore.replaceAll("\\", "/")}`,
          "storePassword=placeholder-only",
          "keyAlias=hongtai-release",
          "keyPassword=placeholder-only",
          "",
        ].join("\n"),
        "utf8",
      );
      const propertiesBytes = readFileSync(properties);
      assert.notDeepEqual(
        [...propertiesBytes.subarray(0, 3)],
        [0xef, 0xbb, 0xbf],
      );

      const environment = windowsAndroidEnvironment();
      environment.HONGTAI_RELEASE_SIGNING_PROPERTIES = properties;
      const gradle = runGradle([":app:testReleaseUnitTest"], environment);
      assert.equal(gradle.error, undefined);
      assert.equal(gradle.status, 0, commandOutput(gradle));
      assert.doesNotMatch(
        commandOutput(gradle),
        /Release signing keystore must be an existing file/,
      );
    } finally {
      if (existsSync(properties)) {
        unlinkSync(properties);
      }
      if (existsSync(keyStore)) {
        unlinkSync(keyStore);
      }
      if (existsSync(signingDirectory)) {
        rmdirSync(signingDirectory);
      }
      rmdirSync(fixtureRoot);
    }
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

test(
  "Windows scripts reject startup through a repository junction",
  { skip: windowsOnly },
  () => {
    const initSource = read("scripts/init-android-release-signing.ps1");
    const buildSource = read("scripts/build-android-release.ps1");
    for (const source of [initSource, buildSource]) {
      assert.match(
        source,
        /Assert-NoReparsePoint\s+-Path\s+\$rawRepositoryRoot/,
      );
    }

    const repositoryPath = realpathSync(root);
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "hongtai-release-repository-junction-"),
    );
    const repositoryJunction = join(fixtureRoot, "repo-link");
    const fakeBin = join(fixtureRoot, "fake-bin");
    const pnpmMarker = join(fixtureRoot, "pnpm-invoked.marker");
    const fakePnpm = join(fakeBin, "pnpm.cmd");
    const internalSigningDirectory = join(root, "android");
    const signingTargetNames = [
      "hongtai-release.jks",
      "keystore.properties",
      "hongtai-release.cer",
    ];
    for (const name of signingTargetNames) {
      assert.equal(existsSync(join(internalSigningDirectory, name)), false);
    }
    const aclBefore = aclSnapshot(internalSigningDirectory);

    try {
      symlinkSync(repositoryPath, repositoryJunction, "junction");
      mkdirSync(fakeBin);
      writeFileSync(
        fakePnpm,
        `@echo off\r\ntype nul > "${pnpmMarker}"\r\nexit /b 99\r\n`,
        "utf8",
      );
      const guardedEnvironment = {
        ...process.env,
        PATH: `${fakeBin};${process.env.PATH ?? ""}`,
      };

      const init = powershellFile(
        join(
          repositoryJunction,
          "scripts",
          "init-android-release-signing.ps1",
        ),
        ["-SigningDirectory", internalSigningDirectory],
        guardedEnvironment,
      );
      assert.equal(init.error, undefined);
      assert.notEqual(init.status, 0);
      assert.match(
        commandOutput(init),
        /Repository path must not traverse a reparse point/,
      );

      const build = powershellFile(
        join(
          repositoryJunction,
          "scripts",
          "build-android-release.ps1",
        ),
        [
          "-SigningProperties",
          join(root, "android", "keystore.properties.example"),
        ],
        guardedEnvironment,
      );
      assert.equal(build.error, undefined);
      assert.notEqual(build.status, 0);
      assert.match(
        commandOutput(build),
        /Repository path must not traverse a reparse point/,
      );

      assert.equal(existsSync(pnpmMarker), false);
      assert.equal(aclSnapshot(internalSigningDirectory), aclBefore);
      for (const name of signingTargetNames) {
        assert.equal(existsSync(join(internalSigningDirectory, name)), false);
      }
    } finally {
      if (existsSync(repositoryJunction)) {
        assert.equal(lstatSync(repositoryJunction).isSymbolicLink(), true);
        rmdirSync(repositoryJunction);
      }
      if (existsSync(pnpmMarker)) {
        unlinkSync(pnpmMarker);
      }
      if (existsSync(fakePnpm)) {
        unlinkSync(fakePnpm);
      }
      if (existsSync(fakeBin)) {
        rmdirSync(fakeBin);
      }
      rmdirSync(fixtureRoot);
    }
  },
);

test(
  "Windows signing initialization preserves existing ACLs and publishes atomically",
  { skip: windowsOnly },
  () => {
    const initSource = read("scripts/init-android-release-signing.ps1");
    assert.match(initSource, /must not already exist/);
    assert.match(initSource, /Publish-AndroidReleaseSigningDirectory/);
    assert.match(initSource, /Remove-AndroidReleaseSigningStagingDirectory/);
    assert.equal(
      existsSync(join(root, "scripts", "android-release-signing-transaction.psm1")),
      true,
    );

    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "hongtai-release-signing-transaction-"),
    );
    const existingDirectory = join(fixtureRoot, "existing-signing");
    const existingSentinel = join(existingDirectory, "sentinel.txt");
    const stagingDirectory = join(
      fixtureRoot,
      ".signing.0123456789abcdef0123456789abcdef.staging",
    );
    const finalDirectory = join(fixtureRoot, "final-signing");
    const finalSentinel = join(finalDirectory, "sentinel.txt");
    const stagedNames = [
      "hongtai-release.jks",
      "keystore.properties",
      "hongtai-release.cer",
    ];

    mkdirSync(existingDirectory);
    writeFileSync(existingSentinel, "preserve-existing-directory", "utf8");
    const existingHashBefore = fileSha256(existingSentinel);
    const existingAclBefore = aclSnapshot(existingDirectory);

    try {
      const init = powershellFile(
        join(root, "scripts", "init-android-release-signing.ps1"),
        ["-SigningDirectory", existingDirectory],
      );
      assert.equal(init.error, undefined);
      assert.notEqual(init.status, 0);
      assert.match(commandOutput(init), /must not already exist/);
      assert.equal(fileSha256(existingSentinel), existingHashBefore);
      assert.equal(aclSnapshot(existingDirectory), existingAclBefore);

      mkdirSync(stagingDirectory);
      mkdirSync(finalDirectory);
      for (const name of stagedNames) {
        writeFileSync(join(stagingDirectory, name), `placeholder-${name}`, "utf8");
      }
      writeFileSync(finalSentinel, "preserve-final-directory", "utf8");
      const finalHashBefore = fileSha256(finalSentinel);
      const finalAclBefore = aclSnapshot(finalDirectory);
      const modulePath = join(
        root,
        "scripts",
        "android-release-signing-transaction.psm1",
      );
      const publish = powershellCommand(
        `Import-Module ${powershellQuote(modulePath)} -Force; ` +
          `try { Publish-AndroidReleaseSigningDirectory ` +
          `-StagingDirectory ${powershellQuote(stagingDirectory)} ` +
          `-FinalDirectory ${powershellQuote(finalDirectory)} ` +
          `-ExpectedParentDirectory ${powershellQuote(fixtureRoot)} } ` +
          `finally { Remove-AndroidReleaseSigningStagingDirectory ` +
          `-StagingDirectory ${powershellQuote(stagingDirectory)} ` +
          `-ExpectedParentDirectory ${powershellQuote(fixtureRoot)} }`,
      );
      assert.equal(publish.error, undefined);
      assert.notEqual(publish.status, 0);
      assert.match(commandOutput(publish), /already exists/);
      assert.equal(existsSync(stagingDirectory), false);
      assert.equal(fileSha256(finalSentinel), finalHashBefore);
      assert.equal(aclSnapshot(finalDirectory), finalAclBefore);
      for (const name of stagedNames) {
        assert.equal(existsSync(join(finalDirectory, name)), false);
      }
    } finally {
      if (existsSync(existingSentinel)) {
        unlinkSync(existingSentinel);
      }
      if (existsSync(existingDirectory)) {
        rmdirSync(existingDirectory);
      }
      if (existsSync(stagingDirectory)) {
        for (const name of stagedNames) {
          const stagedFile = join(stagingDirectory, name);
          if (existsSync(stagedFile)) {
            unlinkSync(stagedFile);
          }
        }
        rmdirSync(stagingDirectory);
      }
      if (existsSync(finalSentinel)) {
        unlinkSync(finalSentinel);
      }
      if (existsSync(finalDirectory)) {
        rmdirSync(finalDirectory);
      }
      rmdirSync(fixtureRoot);
    }
  },
);

test(
  "Windows cleanup helper refuses an ordinary directory with signing files",
  { skip: windowsOnly },
  () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "hongtai-release-cleanup-refusal-"),
    );
    const ordinaryDirectory = join(fixtureRoot, "final-signing");
    const signingNames = [
      "hongtai-release.jks",
      "keystore.properties",
      "hongtai-release.cer",
    ];
    mkdirSync(ordinaryDirectory);
    for (const name of signingNames) {
      writeFileSync(join(ordinaryDirectory, name), `preserve-${name}`, "utf8");
    }
    const hashesBefore = signingNames.map((name) =>
      fileSha256(join(ordinaryDirectory, name)),
    );
    const aclBefore = aclSnapshot(ordinaryDirectory);

    try {
      const modulePath = join(
        root,
        "scripts",
        "android-release-signing-transaction.psm1",
      );
      const cleanup = powershellCommand(
        `Import-Module ${powershellQuote(modulePath)} -Force; ` +
          `Remove-AndroidReleaseSigningStagingDirectory ` +
          `-StagingDirectory ${powershellQuote(ordinaryDirectory)} ` +
          `-ExpectedParentDirectory ${powershellQuote(fixtureRoot)}`,
      );
      assert.equal(cleanup.error, undefined);
      assert.notEqual(cleanup.status, 0);
      assert.match(commandOutput(cleanup), /not a valid release signing staging directory/);
      assert.equal(existsSync(ordinaryDirectory), true);
      assert.equal(aclSnapshot(ordinaryDirectory), aclBefore);
      for (const [index, name] of signingNames.entries()) {
        assert.equal(
          fileSha256(join(ordinaryDirectory, name)),
          hashesBefore[index],
        );
      }
    } finally {
      for (const name of signingNames) {
        const material = join(ordinaryDirectory, name);
        if (existsSync(material)) {
          unlinkSync(material);
        }
      }
      if (existsSync(ordinaryDirectory)) {
        rmdirSync(ordinaryDirectory);
      }
      rmdirSync(fixtureRoot);
    }
  },
);

test(
  "Windows cleanup helper deletes only a valid GUID staging directory",
  { skip: windowsOnly },
  () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "hongtai-release-cleanup-valid-"),
    );
    const stagingDirectory = join(
      fixtureRoot,
      ".signing.fedcba9876543210fedcba9876543210.staging",
    );
    const signingNames = [
      "hongtai-release.jks",
      "keystore.properties",
      "hongtai-release.cer",
    ];
    mkdirSync(stagingDirectory);
    for (const name of signingNames) {
      writeFileSync(join(stagingDirectory, name), `cleanup-${name}`, "utf8");
    }

    try {
      const modulePath = join(
        root,
        "scripts",
        "android-release-signing-transaction.psm1",
      );
      const cleanup = powershellCommand(
        `Import-Module ${powershellQuote(modulePath)} -Force; ` +
          `Remove-AndroidReleaseSigningStagingDirectory ` +
          `-StagingDirectory ${powershellQuote(stagingDirectory)} ` +
          `-ExpectedParentDirectory ${powershellQuote(fixtureRoot)}`,
      );
      assert.equal(cleanup.error, undefined);
      assert.equal(cleanup.status, 0, commandOutput(cleanup));
      assert.equal(existsSync(stagingDirectory), false);
    } finally {
      if (existsSync(stagingDirectory)) {
        for (const name of signingNames) {
          const material = join(stagingDirectory, name);
          if (existsSync(material)) {
            unlinkSync(material);
          }
        }
        rmdirSync(stagingDirectory);
      }
      rmdirSync(fixtureRoot);
    }
  },
);
