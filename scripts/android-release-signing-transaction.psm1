Set-StrictMode -Version 2.0

function Publish-AndroidReleaseSigningDirectory {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string] $StagingDirectory,
    [Parameter(Mandatory = $true)][string] $FinalDirectory
  )

  $stagingPath = [System.IO.Path]::GetFullPath($StagingDirectory)
  $finalPath = [System.IO.Path]::GetFullPath($FinalDirectory)
  $stagingParent = [System.IO.Path]::GetDirectoryName($stagingPath)
  $finalParent = [System.IO.Path]::GetDirectoryName($finalPath)
  if (!$stagingParent.Equals(
      $finalParent,
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw "Release signing staging and final directories must share one parent"
  }
  if (!(Test-Path -LiteralPath $stagingPath -PathType Container)) {
    throw "Release signing staging directory is required"
  }
  if (Test-Path -LiteralPath $finalPath) {
    throw "Release signing directory already exists; refusing atomic publication"
  }

  [System.IO.Directory]::Move($stagingPath, $finalPath)
}

function Remove-AndroidReleaseSigningStagingDirectory {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string] $StagingDirectory)

  $stagingPath = [System.IO.Path]::GetFullPath($StagingDirectory)
  if (!(Test-Path -LiteralPath $stagingPath)) {
    return
  }
  if (!(Test-Path -LiteralPath $stagingPath -PathType Container)) {
    throw "Release signing staging path is not a directory"
  }

  foreach ($name in @(
      "hongtai-release.jks",
      "keystore.properties",
      "hongtai-release.cer"
    )) {
    $stagedFile = Join-Path $stagingPath $name
    if (Test-Path -LiteralPath $stagedFile -PathType Leaf) {
      [System.IO.File]::Delete($stagedFile)
    }
  }

  $remainingEntries = @([System.IO.Directory]::EnumerateFileSystemEntries($stagingPath))
  if ($remainingEntries.Count -ne 0) {
    throw "Release signing staging directory contains an unexpected entry"
  }
  [System.IO.Directory]::Delete($stagingPath)
}

Export-ModuleMember -Function @(
  "Publish-AndroidReleaseSigningDirectory",
  "Remove-AndroidReleaseSigningStagingDirectory"
)
