import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const root = process.cwd();
export const windowsOnly =
  process.platform === "win32" ? false : "Windows-only signing behavior";

export function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

export function windowsAndroidEnvironment(): NodeJS.ProcessEnv {
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

export function runGradle(
  tasks: string[],
  environment = windowsAndroidEnvironment(),
) {
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

export function commandOutput(result: ReturnType<typeof spawnSync>): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

export function powershellFile(
  script: string,
  args: string[] = [],
  env = process.env,
) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
    { cwd: root, encoding: "utf8", env },
  );
}

export function powershellCommand(command: string) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { cwd: root, encoding: "utf8", env: process.env },
  );
}

export function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function aclSnapshot(path: string): string {
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

export function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
