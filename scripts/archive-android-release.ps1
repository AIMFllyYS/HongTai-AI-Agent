[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string] $SourceApk,
  [Parameter(Mandatory = $true)][string] $VersionName,
  [Parameter(Mandatory = $true)][string] $ArchiveRoot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop

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
  $segments = $relativePath.Split($pathSeparators, [System.StringSplitOptions]::RemoveEmptyEntries)
  foreach ($segment in $segments) {
    $currentPath = Join-Path $currentPath $segment
    if (!(Test-Path -LiteralPath $currentPath)) { break }
    $item = Get-Item -Force -LiteralPath $currentPath
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw $FailureMessage
    }
  }
}

if ($VersionName -notmatch '^[0-9]+[.][0-9]+[.][0-9]+$') {
  throw "VersionName must use MAJOR.MINOR.PATCH"
}

$resolvedSource = [System.IO.Path]::GetFullPath($SourceApk)
Assert-NoReparsePoint -Path $resolvedSource `
  -FailureMessage "Release APK source must not traverse a reparse point"
if (!(Test-Path -LiteralPath $resolvedSource -PathType Leaf)) {
  throw "Release APK source file does not exist"
}

$resolvedArchiveRoot = [System.IO.Path]::GetFullPath($ArchiveRoot)
Assert-NoReparsePoint -Path $resolvedArchiveRoot `
  -FailureMessage "Release APK archive must not traverse a reparse point"
[System.IO.Directory]::CreateDirectory($resolvedArchiveRoot) | Out-Null
Assert-NoReparsePoint -Path $resolvedArchiveRoot `
  -FailureMessage "Release APK archive must not traverse a reparse point"
$archiveName = "HongTai-AI-Agent-release-v$VersionName.apk"
$archivePath = Join-Path $resolvedArchiveRoot $archiveName
Assert-NoReparsePoint -Path $archivePath `
  -FailureMessage "Release APK archive file must not be a reparse point"
$sourceHash = (Get-FileHash -LiteralPath $resolvedSource -Algorithm SHA256).Hash.ToLowerInvariant()

if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
  $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($archiveHash -ne $sourceHash) {
    throw "Refusing to overwrite archived APK with different bytes"
  }
} else {
  Copy-Item -LiteralPath $resolvedSource -Destination $archivePath
}

Write-Output "Archived Release APK: $archivePath"
Write-Output "Archived APK SHA-256: $sourceHash"
