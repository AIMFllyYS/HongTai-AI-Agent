import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  aclSnapshot,
  commandOutput,
  fileSha256,
  powershellCommand,
  powershellQuote,
  root,
  windowsOnly,
} from "./support/android-release-signing.js";

const modulePath = join(
  root,
  "scripts",
  "android-release-signing-transaction.psm1",
);
const signingNames = [
  "hongtai-release.jks",
  "keystore.properties",
  "hongtai-release.cer",
];

function writeSigningPlaceholders(directory: string, prefix: string): void {
  for (const name of signingNames) {
    writeFileSync(join(directory, name), `${prefix}-${name}`, "utf8");
  }
}

function invokeCleanup(stagingDirectory: string, expectedParent: string) {
  return powershellCommand(
    `Import-Module ${powershellQuote(modulePath)} -Force; ` +
      `Remove-AndroidReleaseSigningStagingDirectory ` +
      `-StagingDirectory ${powershellQuote(stagingDirectory)} ` +
      `-ExpectedParentDirectory ${powershellQuote(expectedParent)}`,
  );
}

function removeKnownFiles(directory: string): void {
  for (const name of signingNames) {
    const material = join(directory, name);
    if (existsSync(material)) unlinkSync(material);
  }
}

test(
  "Windows atomic publication preserves a conflicting final directory",
  { skip: windowsOnly },
  () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "hongtai-release-signing-transaction-"),
    );
    const stagingDirectory = join(
      fixtureRoot,
      ".signing.0123456789abcdef0123456789abcdef.staging",
    );
    const finalDirectory = join(fixtureRoot, "final-signing");
    const sentinel = join(finalDirectory, "sentinel.txt");
    mkdirSync(stagingDirectory);
    mkdirSync(finalDirectory);
    writeSigningPlaceholders(stagingDirectory, "placeholder");
    writeFileSync(sentinel, "preserve-final-directory", "utf8");
    const hashBefore = fileSha256(sentinel);
    const aclBefore = aclSnapshot(finalDirectory);

    try {
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
      assert.equal(fileSha256(sentinel), hashBefore);
      assert.equal(aclSnapshot(finalDirectory), aclBefore);
      for (const name of signingNames) {
        assert.equal(existsSync(join(finalDirectory, name)), false);
      }
    } finally {
      if (existsSync(stagingDirectory)) {
        removeKnownFiles(stagingDirectory);
        rmdirSync(stagingDirectory);
      }
      if (existsSync(sentinel)) unlinkSync(sentinel);
      if (existsSync(finalDirectory)) rmdirSync(finalDirectory);
      rmdirSync(fixtureRoot);
    }
  },
);

test(
  "Windows cleanup refuses an ordinary directory with signing files",
  { skip: windowsOnly },
  () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "hongtai-cleanup-refusal-"));
    const ordinaryDirectory = join(fixtureRoot, "final-signing");
    mkdirSync(ordinaryDirectory);
    writeSigningPlaceholders(ordinaryDirectory, "preserve");
    const hashesBefore = signingNames.map((name) =>
      fileSha256(join(ordinaryDirectory, name)),
    );
    const aclBefore = aclSnapshot(ordinaryDirectory);
    try {
      const cleanup = invokeCleanup(ordinaryDirectory, fixtureRoot);
      assert.equal(cleanup.error, undefined);
      assert.notEqual(cleanup.status, 0);
      assert.match(commandOutput(cleanup), /not a valid release signing staging directory/);
      assert.equal(aclSnapshot(ordinaryDirectory), aclBefore);
      for (const [index, name] of signingNames.entries()) {
        assert.equal(fileSha256(join(ordinaryDirectory, name)), hashesBefore[index]);
      }
    } finally {
      removeKnownFiles(ordinaryDirectory);
      rmdirSync(ordinaryDirectory);
      rmdirSync(fixtureRoot);
    }
  },
);

test(
  "Windows cleanup deletes only a valid GUID staging directory",
  { skip: windowsOnly },
  () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "hongtai-cleanup-valid-"));
    const stagingDirectory = join(
      fixtureRoot,
      ".signing.fedcba9876543210fedcba9876543210.staging",
    );
    mkdirSync(stagingDirectory);
    writeSigningPlaceholders(stagingDirectory, "cleanup");
    try {
      const cleanup = invokeCleanup(stagingDirectory, fixtureRoot);
      assert.equal(cleanup.error, undefined);
      assert.equal(cleanup.status, 0, commandOutput(cleanup));
      assert.equal(existsSync(stagingDirectory), false);
    } finally {
      if (existsSync(stagingDirectory)) {
        removeKnownFiles(stagingDirectory);
        rmdirSync(stagingDirectory);
      }
      rmdirSync(fixtureRoot);
    }
  },
);

test(
  "Windows cleanup validates unexpected entries before deleting known files",
  { skip: windowsOnly },
  () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "hongtai-cleanup-unexpected-"));
    const stagingDirectory = join(
      fixtureRoot,
      ".signing.11111111111111111111111111111111.staging",
    );
    const unexpected = join(stagingDirectory, "unexpected.txt");
    mkdirSync(stagingDirectory);
    writeSigningPlaceholders(stagingDirectory, "preserve");
    writeFileSync(unexpected, "preserve-unexpected", "utf8");
    const knownHashes = signingNames.map((name) =>
      fileSha256(join(stagingDirectory, name)),
    );
    const unexpectedHash = fileSha256(unexpected);
    const aclBefore = aclSnapshot(stagingDirectory);
    try {
      const cleanup = invokeCleanup(stagingDirectory, fixtureRoot);
      assert.equal(cleanup.error, undefined);
      assert.notEqual(cleanup.status, 0);
      assert.match(commandOutput(cleanup), /contains an unexpected entry/);
      assert.equal(aclSnapshot(stagingDirectory), aclBefore);
      assert.equal(fileSha256(unexpected), unexpectedHash);
      for (const [index, name] of signingNames.entries()) {
        assert.equal(fileSha256(join(stagingDirectory, name)), knownHashes[index]);
      }
    } finally {
      if (existsSync(unexpected)) unlinkSync(unexpected);
      removeKnownFiles(stagingDirectory);
      rmdirSync(stagingDirectory);
      rmdirSync(fixtureRoot);
    }
  },
);

test(
  "Windows cleanup rejects a known-name reparse entry before deleting peers",
  { skip: windowsOnly },
  () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "hongtai-cleanup-reparse-"));
    const stagingDirectory = join(
      fixtureRoot,
      ".signing.22222222222222222222222222222222.staging",
    );
    const externalTarget = join(fixtureRoot, "external-target");
    const targetSentinel = join(externalTarget, "target-sentinel.txt");
    const reparseEntry = join(stagingDirectory, "hongtai-release.jks");
    mkdirSync(stagingDirectory);
    mkdirSync(externalTarget);
    writeFileSync(targetSentinel, "preserve-external-target", "utf8");
    for (const name of signingNames.slice(1)) {
      writeFileSync(join(stagingDirectory, name), `preserve-${name}`, "utf8");
    }
    symlinkSync(externalTarget, reparseEntry, "junction");
    const peerHashes = signingNames.slice(1).map((name) =>
      fileSha256(join(stagingDirectory, name)),
    );
    const targetHash = fileSha256(targetSentinel);
    const aclBefore = aclSnapshot(stagingDirectory);
    try {
      const cleanup = invokeCleanup(stagingDirectory, fixtureRoot);
      assert.equal(cleanup.error, undefined);
      assert.notEqual(cleanup.status, 0);
      assert.match(commandOutput(cleanup), /staging file must not be a reparse point/);
      assert.equal(lstatSync(reparseEntry).isSymbolicLink(), true);
      assert.equal(fileSha256(targetSentinel), targetHash);
      assert.equal(aclSnapshot(stagingDirectory), aclBefore);
      for (const [index, name] of signingNames.slice(1).entries()) {
        assert.equal(fileSha256(join(stagingDirectory, name)), peerHashes[index]);
      }
    } finally {
      if (existsSync(reparseEntry)) {
        assert.equal(lstatSync(reparseEntry).isSymbolicLink(), true);
        rmdirSync(reparseEntry);
      }
      removeKnownFiles(stagingDirectory);
      rmdirSync(stagingDirectory);
      if (existsSync(targetSentinel)) unlinkSync(targetSentinel);
      rmdirSync(externalTarget);
      rmdirSync(fixtureRoot);
    }
  },
);
