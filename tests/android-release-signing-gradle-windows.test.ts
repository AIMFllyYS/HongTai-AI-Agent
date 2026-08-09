import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  commandOutput,
  runGradle,
  windowsAndroidEnvironment,
  windowsOnly,
} from "./support/android-release-signing.js";

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
