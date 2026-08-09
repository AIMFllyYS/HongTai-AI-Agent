import assert from "node:assert/strict";
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
import {
  aclSnapshot,
  commandOutput,
  fileSha256,
  powershellFile,
  read,
  root,
  runGradle,
  windowsAndroidEnvironment,
  windowsOnly,
} from "./support/android-release-signing.js";

test(
  "Windows signing entrypoints reject a repository junction alias",
  { skip: windowsOnly },
  () => {
    const repositoryPath = realpathSync(root);
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "hongtai-release-signing-junction-"),
    );
    assert.notEqual(
      realpathSync(fixtureRoot).toLowerCase().startsWith(
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

      const init = powershellFile(
        join(root, "scripts", "init-android-release-signing.ps1"),
        ["-SigningDirectory", junctionInitTarget],
      );
      assert.equal(init.error, undefined);
      assert.notEqual(init.status, 0);
      assert.match(commandOutput(init), /must not traverse a reparse point/);
      assert.equal(existsSync(repositoryInitTarget), false);

      const build = powershellFile(
        join(root, "scripts", "build-android-release.ps1"),
        [
          "-SigningProperties",
          join(repositoryJunction, "android", "keystore.properties.example"),
        ],
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
    } finally {
      if (existsSync(repositoryJunction)) {
        assert.equal(lstatSync(repositoryJunction).isSymbolicLink(), true);
        rmdirSync(repositoryJunction);
      }
      if (existsSync(externalProperties)) unlinkSync(externalProperties);
      rmdirSync(fixtureRoot);
    }
    assert.equal(existsSync(repositoryInitTarget), false);
    assert.equal(existsSync(join(root, ".git")), true);
  },
);

test(
  "Windows scripts reject startup through a repository junction",
  { skip: windowsOnly },
  () => {
    for (const source of [
      read("scripts/init-android-release-signing.ps1"),
      read("scripts/build-android-release.ps1"),
    ]) {
      assert.match(source, /Assert-NoReparsePoint\s+-Path\s+\$rawRepositoryRoot/);
    }
    const repositoryJunctionRoot = mkdtempSync(
      join(tmpdir(), "hongtai-release-repository-junction-"),
    );
    const repositoryJunction = join(repositoryJunctionRoot, "repo-link");
    const fakeBin = join(repositoryJunctionRoot, "fake-bin");
    const pnpmMarker = join(repositoryJunctionRoot, "pnpm-invoked.marker");
    const fakePnpm = join(fakeBin, "pnpm.cmd");
    const internalSigningDirectory = join(root, "android");
    const targetNames = [
      "hongtai-release.jks",
      "keystore.properties",
      "hongtai-release.cer",
    ];
    const aclBefore = aclSnapshot(internalSigningDirectory);

    try {
      symlinkSync(realpathSync(root), repositoryJunction, "junction");
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
        join(repositoryJunction, "scripts", "init-android-release-signing.ps1"),
        ["-SigningDirectory", internalSigningDirectory],
        guardedEnvironment,
      );
      const build = powershellFile(
        join(repositoryJunction, "scripts", "build-android-release.ps1"),
        [
          "-SigningProperties",
          join(root, "android", "keystore.properties.example"),
        ],
        guardedEnvironment,
      );
      for (const result of [init, build]) {
        assert.equal(result.error, undefined);
        assert.notEqual(result.status, 0);
        assert.match(
          commandOutput(result),
          /Repository path must not traverse a reparse point/,
        );
      }
      assert.equal(existsSync(pnpmMarker), false);
      assert.equal(aclSnapshot(internalSigningDirectory), aclBefore);
      for (const name of targetNames) {
        assert.equal(existsSync(join(internalSigningDirectory, name)), false);
      }
    } finally {
      if (existsSync(repositoryJunction)) rmdirSync(repositoryJunction);
      if (existsSync(pnpmMarker)) unlinkSync(pnpmMarker);
      if (existsSync(fakePnpm)) unlinkSync(fakePnpm);
      if (existsSync(fakeBin)) rmdirSync(fakeBin);
      rmdirSync(repositoryJunctionRoot);
    }
  },
);

test(
  "Windows signing initialization preserves an existing directory ACL",
  { skip: windowsOnly },
  () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "hongtai-release-acl-"));
    const existingDirectory = join(fixtureRoot, "existing-signing");
    const sentinel = join(existingDirectory, "sentinel.txt");
    mkdirSync(existingDirectory);
    writeFileSync(sentinel, "preserve-existing-directory", "utf8");
    const hashBefore = fileSha256(sentinel);
    const aclBefore = aclSnapshot(existingDirectory);
    try {
      const init = powershellFile(
        join(root, "scripts", "init-android-release-signing.ps1"),
        ["-SigningDirectory", existingDirectory],
      );
      assert.equal(init.error, undefined);
      assert.notEqual(init.status, 0);
      assert.match(commandOutput(init), /must not already exist/);
      assert.equal(fileSha256(sentinel), hashBefore);
      assert.equal(aclSnapshot(existingDirectory), aclBefore);
    } finally {
      if (existsSync(sentinel)) unlinkSync(sentinel);
      if (existsSync(existingDirectory)) rmdirSync(existingDirectory);
      rmdirSync(fixtureRoot);
    }
  },
);

test(
  "Windows normalizer preserves XML semantics and removes generated whitespace",
  { skip: windowsOnly },
  () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "hongtai-cap-config-"));
    const configPath = join(fixtureRoot, "config.xml");
    const input =
      "\ufeff<?xml version='1.0' encoding='utf-8'?>\r\n" +
      '<widget id="keep">  \r\n' +
      '  <plugin name="semantic-line" />\t\r\n' +
      "  \r\n\r\n</widget>\r\n\r\n";
    writeFileSync(configPath, input, "utf8");
    try {
      const result = powershellFile(
        join(root, "scripts", "normalize-capacitor-config.ps1"),
        ["-ConfigPath", configPath],
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, commandOutput(result));
      const bytes = readFileSync(configPath);
      assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      assert.equal(
        bytes.toString("utf8"),
        "<?xml version='1.0' encoding='utf-8'?>\n" +
          '<widget id="keep">\n' +
          '  <plugin name="semantic-line" />\n' +
          "</widget>\n",
      );
    } finally {
      if (existsSync(configPath)) unlinkSync(configPath);
      rmdirSync(fixtureRoot);
    }
  },
);
