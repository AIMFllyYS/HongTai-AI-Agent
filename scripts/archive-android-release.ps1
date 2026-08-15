[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string] $SourceApk,
  [Parameter(Mandatory = $true)][string] $VersionName,
  [Parameter(Mandatory = $true)][string] $ArchiveRoot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop

if ($VersionName -notmatch '^[0-9]+[.][0-9]+[.][0-9]+$') {
  throw "VersionName must use MAJOR.MINOR.PATCH"
}

$resolvedSource = [System.IO.Path]::GetFullPath($SourceApk)
if (!(Test-Path -LiteralPath $resolvedSource -PathType Leaf)) {
  throw "Release APK source file does not exist"
}

$resolvedArchiveRoot = [System.IO.Path]::GetFullPath($ArchiveRoot)
[System.IO.Directory]::CreateDirectory($resolvedArchiveRoot) | Out-Null
$archiveName = "HongTai-AI-Agent-release-v$VersionName.apk"
$archivePath = Join-Path $resolvedArchiveRoot $archiveName
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
