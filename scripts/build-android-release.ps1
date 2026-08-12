[CmdletBinding()]
param(
  [string] $SigningProperties
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

function Resolve-CanonicalPath {
  param([Parameter(Mandatory = $true)][string] $Path)

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if (Test-Path -LiteralPath $fullPath) {
    return (Resolve-Path -LiteralPath $fullPath).ProviderPath
  }

  $missingSegments = New-Object 'System.Collections.Generic.Stack[string]'
  $existingAncestor = $fullPath
  while (!(Test-Path -LiteralPath $existingAncestor)) {
    $trimmed = $existingAncestor.TrimEnd(
      [char[]] @([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    )
    $leaf = [System.IO.Path]::GetFileName($trimmed)
    $parent = [System.IO.Path]::GetDirectoryName($trimmed)
    if ([string]::IsNullOrWhiteSpace($leaf) -or
        [string]::IsNullOrWhiteSpace($parent) -or
        $parent -eq $existingAncestor) {
      return $fullPath
    }
    $missingSegments.Push($leaf)
    $existingAncestor = $parent
  }

  $canonicalPath = (Resolve-Path -LiteralPath $existingAncestor).ProviderPath
  while ($missingSegments.Count -gt 0) {
    $canonicalPath = Join-Path $canonicalPath $missingSegments.Pop()
  }
  return [System.IO.Path]::GetFullPath($canonicalPath)
}

function Assert-NoReparsePoint {
  param(
    [Parameter(Mandatory = $true)][string] $Path,
    [Parameter(Mandatory = $true)][string] $FailureMessage
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
  $currentPath = $pathRoot
  $relativePath = $fullPath.Substring($pathRoot.Length)
  $pathSeparators = [char[]] @(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $segments = $relativePath.Split(
    $pathSeparators,
    [System.StringSplitOptions]::RemoveEmptyEntries
  )
  foreach ($segment in $segments) {
    $currentPath = Join-Path $currentPath $segment
    if (!(Test-Path -LiteralPath $currentPath)) {
      break
    }
    $item = Get-Item -Force -LiteralPath $currentPath
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw $FailureMessage
    }
  }
}

function Test-PathInsideRepository {
  param(
    [Parameter(Mandatory = $true)][string] $CandidatePath,
    [Parameter(Mandatory = $true)][string] $RepositoryRoot
  )

  $pathSeparators = [char[]] @(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $candidate = (Resolve-CanonicalPath -Path $CandidatePath).TrimEnd($pathSeparators)
  $repository = (Resolve-CanonicalPath -Path $RepositoryRoot).TrimEnd($pathSeparators)
  return $candidate.Equals($repository, [System.StringComparison]::OrdinalIgnoreCase) -or
    $candidate.StartsWith(
      $repository + [System.IO.Path]::DirectorySeparatorChar,
      [System.StringComparison]::OrdinalIgnoreCase
    )
}

function Get-Jdk21Home {
  $candidates = @(
    $env:JAVA_HOME,
    (Join-Path $env:ProgramFiles "Android\Android Studio\jbr")
  ) | Where-Object { $_ } | Select-Object -Unique

  foreach ($candidate in $candidates) {
    $java = Join-Path $candidate "bin\java.exe"
    if (!(Test-Path -LiteralPath $java -PathType Leaf)) {
      continue
    }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $java
    $startInfo.Arguments = "-version"
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $versionOutput = $process.StandardOutput.ReadToEnd() + $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -eq 0 -and $versionOutput -match 'version "21[\.]') {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }

  throw "JDK 21 is required; configure JAVA_HOME or install Android Studio JBR 21"
}

function Get-AndroidSdkHome {
  $candidates = @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    (Join-Path $env:LOCALAPPDATA "Android\Sdk")
  ) | Where-Object { $_ } | Select-Object -Unique

  foreach ($candidate in $candidates) {
    $resolved = [System.IO.Path]::GetFullPath($candidate)
    if (Test-Path -LiteralPath (Join-Path $resolved "build-tools") -PathType Container) {
      return $resolved
    }
  }

  throw "Android SDK with build-tools is required"
}

function Get-CompleteBuildTools {
  param([Parameter(Mandatory = $true)][string] $AndroidSdk)

  $complete = Get-ChildItem -LiteralPath (Join-Path $AndroidSdk "build-tools") -Directory |
    Where-Object {
      (Test-Path -LiteralPath (Join-Path $_.FullName "zipalign.exe") -PathType Leaf) -and
      (Test-Path -LiteralPath (Join-Path $_.FullName "aapt2.exe") -PathType Leaf) -and
      (Test-Path -LiteralPath (Join-Path $_.FullName "apksigner.bat") -PathType Leaf)
    } |
    Sort-Object -Property @{ Expression = {
      try { [version] $_.Name } catch { [version] "0.0" }
    } } -Descending |
    Select-Object -First 1

  if ($null -eq $complete) {
    throw "Android SDK build-tools must include zipalign, aapt2, and apksigner"
  }
  return $complete.FullName
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string] $Command,
    [Parameter(Mandatory = $true)][string[]] $Arguments,
    [Parameter(Mandatory = $true)][string] $FailureMessage
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

$rawRepositoryRoot = Join-Path $PSScriptRoot ".."
Assert-NoReparsePoint -Path $rawRepositoryRoot `
  -FailureMessage "Repository path must not traverse a reparse point"
$repositoryRoot = Resolve-CanonicalPath -Path $rawRepositoryRoot
$apkPath = Join-Path $repositoryRoot "android\app\build\outputs\apk\release\app-release.apk"
$anchorPath = Join-Path $repositoryRoot "android\release-certificate.sha256"
$jdkHome = Get-Jdk21Home
$androidSdk = Get-AndroidSdkHome
$buildTools = Get-CompleteBuildTools -AndroidSdk $androidSdk
$zipalign = Join-Path $buildTools "zipalign.exe"
$aapt2 = Join-Path $buildTools "aapt2.exe"
$apksigner = Join-Path $buildTools "apksigner.bat"

$hadJavaHome = Test-Path Env:JAVA_HOME
$hadAndroidHome = Test-Path Env:ANDROID_HOME
$hadAndroidSdkRoot = Test-Path Env:ANDROID_SDK_ROOT
$hadSigningProperties = Test-Path Env:HONGTAI_RELEASE_SIGNING_PROPERTIES
$previousJavaHome = $env:JAVA_HOME
$previousAndroidHome = $env:ANDROID_HOME
$previousAndroidSdkRoot = $env:ANDROID_SDK_ROOT
$previousSigningProperties = $env:HONGTAI_RELEASE_SIGNING_PROPERTIES

if ([string]::IsNullOrWhiteSpace($SigningProperties)) {
  if (![string]::IsNullOrWhiteSpace($previousSigningProperties)) {
    $SigningProperties = $previousSigningProperties
  } else {
    $SigningProperties = Join-Path $env:APPDATA "HongTai-AI-Agent\signing\keystore.properties"
  }
}
Assert-NoReparsePoint -Path $SigningProperties `
  -FailureMessage "Release signing properties must not traverse a reparse point"
$SigningProperties = Resolve-CanonicalPath -Path $SigningProperties
if (!(Test-Path -LiteralPath $SigningProperties -PathType Leaf)) {
  throw "Release signing properties file is required"
}
if (Test-PathInsideRepository -CandidatePath $SigningProperties -RepositoryRoot $repositoryRoot) {
  throw "Release signing properties must be outside the repository"
}

try {
  $env:JAVA_HOME = $jdkHome
  $env:ANDROID_HOME = $androidSdk
  $env:ANDROID_SDK_ROOT = $androidSdk
  Remove-Item Env:HONGTAI_RELEASE_SIGNING_PROPERTIES -ErrorAction SilentlyContinue

  Push-Location $repositoryRoot
  try {
    Invoke-CheckedCommand -Command "pnpm.cmd" -Arguments @(
      "--filter", "@hongtai/web", "build"
    ) -FailureMessage "Web production build failed"
    Invoke-CheckedCommand -Command "pnpm.cmd" -Arguments @(
      "exec", "cap", "sync", "android"
    ) -FailureMessage "Capacitor Android sync failed"
    & (Join-Path $PSScriptRoot "normalize-capacitor-config.ps1") `
      -ConfigPath (Join-Path $repositoryRoot "android\app\src\main\res\xml\config.xml")
  } finally {
    Pop-Location
  }

  Push-Location (Join-Path $repositoryRoot "android")
  try {
    $env:HONGTAI_RELEASE_SIGNING_PROPERTIES = $SigningProperties
    try {
      Invoke-CheckedCommand -Command (Join-Path $repositoryRoot "android\gradlew.bat") -Arguments @(
        ":app:testReleaseUnitTest",
        ":app:lintRelease",
        ":app:assembleRelease",
        "--no-daemon"
      ) -FailureMessage "Android release tests, lint, or build failed"
    } finally {
      if ($hadSigningProperties) {
        $env:HONGTAI_RELEASE_SIGNING_PROPERTIES = $previousSigningProperties
      } else {
        Remove-Item Env:HONGTAI_RELEASE_SIGNING_PROPERTIES -ErrorAction SilentlyContinue
      }
    }
  } finally {
    Pop-Location
  }

  if (!(Test-Path -LiteralPath $apkPath -PathType Leaf)) {
    throw "Expected release APK was not produced"
  }
  if (!(Test-Path -LiteralPath $anchorPath -PathType Leaf)) {
    throw "Public release certificate anchor is required"
  }

  $zipalignOutput = & $zipalign @("-c", "-P", "16", "-v", "4", $apkPath) 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "Release APK zipalign verification failed"
  }

  $badging = & $aapt2 @("dump", "badging", $apkPath) 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "Release APK manifest verification failed"
  }

  $signature = & $apksigner @("verify", "--verbose", "--print-certs", $apkPath) 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "Release APK signature verification failed"
  }
  if ($signature -notmatch '(?m)^Verified using v2 scheme.*:\s*true\s*$') {
    throw "Release APK must be verified with signature scheme v2"
  }
  if ($signature -notmatch '(?m)^Verified using v3 scheme.*:\s*true\s*$') {
    throw "Release APK must be verified with signature scheme v3"
  }
  if ($signature -match '(?mi)^.*certificate DN:.*Android Debug.*$') {
    throw "Release APK must not use the Android Debug signing identity"
  }

  $dnMatch = [regex]::Match(
    $signature,
    '(?m)^(?:Signer #1|V3[.]0 Signer): certificate DN:\s*([^\r\n]+)\r?$'
  )
  if (!$dnMatch.Success) {
    throw "Release APK signer DN is missing"
  }
  $signerDn = $dnMatch.Groups[1].Value.Trim()

  $fingerprintMatch = [regex]::Match(
    $signature,
    '(?m)^(?:Signer #1|V3[.]0 Signer): certificate SHA-256 digest:\s*([0-9a-fA-F: ]+)\r?$'
  )
  if (!$fingerprintMatch.Success) {
    throw "Release APK signer SHA-256 is missing"
  }
  $signerFingerprint = ($fingerprintMatch.Groups[1].Value -replace '[^0-9a-fA-F]', '').ToLowerInvariant()
  $expectedFingerprint = (Get-Content -LiteralPath $anchorPath -Raw -Encoding UTF8).Trim().ToLowerInvariant()
  if ($expectedFingerprint -notmatch '^[0-9a-f]{64}$') {
    throw "Public release certificate anchor must be one lowercase SHA-256 value"
  }
  if ($signerFingerprint -ne $expectedFingerprint) {
    throw "Release APK signer does not match the public certificate anchor"
  }

  $packageMatch = [regex]::Match(
    $badging,
    "(?m)^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'"
  )
  if (!$packageMatch.Success) {
    throw "Release APK package metadata is missing"
  }
  $packageName = $packageMatch.Groups[1].Value
  $versionCode = $packageMatch.Groups[2].Value
  $versionName = $packageMatch.Groups[3].Value
  if ($packageName -ne "com.hongtai.aiagent" -or $versionCode -ne "13" -or $versionName -ne "0.1.6") {
    throw "Release APK package or version metadata is unexpected"
  }

  $apkSha256 = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Output "Release APK: $apkPath"
  Write-Output "Package: $packageName"
  Write-Output "Version: $versionName ($versionCode)"
  Write-Output "Signer DN: $signerDn"
  Write-Output "Certificate SHA-256: $signerFingerprint"
  Write-Output "APK SHA-256: $apkSha256"
} finally {
  if ($hadJavaHome) { $env:JAVA_HOME = $previousJavaHome } else { Remove-Item Env:JAVA_HOME -ErrorAction SilentlyContinue }
  if ($hadAndroidHome) { $env:ANDROID_HOME = $previousAndroidHome } else { Remove-Item Env:ANDROID_HOME -ErrorAction SilentlyContinue }
  if ($hadAndroidSdkRoot) { $env:ANDROID_SDK_ROOT = $previousAndroidSdkRoot } else { Remove-Item Env:ANDROID_SDK_ROOT -ErrorAction SilentlyContinue }
  if ($hadSigningProperties) { $env:HONGTAI_RELEASE_SIGNING_PROPERTIES = $previousSigningProperties } else { Remove-Item Env:HONGTAI_RELEASE_SIGNING_PROPERTIES -ErrorAction SilentlyContinue }
}
