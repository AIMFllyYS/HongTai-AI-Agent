Set-StrictMode -Version 2.0

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

function Get-AndroidReleaseSigningStagingContext {
  param(
    [Parameter(Mandatory = $true)][string] $StagingDirectory,
    [Parameter(Mandatory = $true)][string] $ExpectedParentDirectory
  )

  $pathSeparators = [char[]] @(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $stagingPath = [System.IO.Path]::GetFullPath($StagingDirectory).TrimEnd($pathSeparators)
  $expectedParentPath = [System.IO.Path]::GetFullPath(
    $ExpectedParentDirectory
  ).TrimEnd($pathSeparators)
  $stagingLeaf = [System.IO.Path]::GetFileName($stagingPath)
  $stagingParent = [System.IO.Path]::GetDirectoryName($stagingPath)

  if ($stagingLeaf -cnotmatch '^\.signing\.[0-9a-f]{32}\.staging$') {
    throw "Path is not a valid release signing staging directory"
  }
  if ([string]::IsNullOrWhiteSpace($stagingParent) -or
      !$stagingParent.Equals(
        $expectedParentPath,
        [System.StringComparison]::OrdinalIgnoreCase
      )) {
    throw "Release signing staging directory is outside the expected parent"
  }
  if (!(Test-Path -LiteralPath $expectedParentPath -PathType Container)) {
    throw "Release signing expected parent directory is required"
  }

  Assert-NoReparsePoint -Path $expectedParentPath `
    -FailureMessage "Release signing expected parent must not traverse a reparse point"
  Assert-NoReparsePoint -Path $stagingPath `
    -FailureMessage "Release signing staging directory must not traverse a reparse point"

  return [PSCustomObject] @{
    StagingPath = $stagingPath
    ExpectedParentPath = $expectedParentPath
  }
}

function Get-ValidatedAndroidReleaseSigningStagedFiles {
  param(
    [Parameter(Mandatory = $true)][string] $StagingPath,
    [switch] $RequireComplete
  )

  $expectedNames = @(
    "hongtai-release.jks",
    "keystore.properties",
    "hongtai-release.cer"
  )
  $validatedFiles = New-Object 'System.Collections.Generic.List[string]'
  $entries = @([System.IO.Directory]::EnumerateFileSystemEntries($StagingPath))
  foreach ($entry in $entries) {
    $entryName = [System.IO.Path]::GetFileName($entry)
    if ($expectedNames -notcontains $entryName) {
      throw "Release signing staging directory contains an unexpected entry"
    }
    $attributes = [System.IO.File]::GetAttributes($entry)
    if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Release signing staging file must not be a reparse point"
    }
    if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
      throw "Release signing staging entry must be a file"
    }
    [void] $validatedFiles.Add($entry)
  }

  if ($RequireComplete) {
    foreach ($name in $expectedNames) {
      $expectedFile = Join-Path $StagingPath $name
      if (!(Test-Path -LiteralPath $expectedFile -PathType Leaf) -or
          (Get-Item -Force -LiteralPath $expectedFile).Length -eq 0) {
        throw "Release signing staging directory is incomplete"
      }
    }
  }

  return @($validatedFiles)
}

function Publish-AndroidReleaseSigningDirectory {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string] $StagingDirectory,
    [Parameter(Mandatory = $true)][string] $FinalDirectory,
    [Parameter(Mandatory = $true)][string] $ExpectedParentDirectory
  )

  $context = Get-AndroidReleaseSigningStagingContext `
    -StagingDirectory $StagingDirectory `
    -ExpectedParentDirectory $ExpectedParentDirectory
  $finalPath = [System.IO.Path]::GetFullPath($FinalDirectory).TrimEnd(
    [char[]] @(
      [System.IO.Path]::DirectorySeparatorChar,
      [System.IO.Path]::AltDirectorySeparatorChar
    )
  )
  $finalParent = [System.IO.Path]::GetDirectoryName($finalPath)
  if ([string]::IsNullOrWhiteSpace($finalParent) -or
      !$finalParent.Equals(
        $context.ExpectedParentPath,
        [System.StringComparison]::OrdinalIgnoreCase
      )) {
    throw "Release signing final directory is outside the expected parent"
  }
  if (!(Test-Path -LiteralPath $context.StagingPath -PathType Container)) {
    throw "Release signing staging directory is required"
  }
  if (Test-Path -LiteralPath $finalPath) {
    throw "Release signing directory already exists; refusing atomic publication"
  }

  [void] (Get-ValidatedAndroidReleaseSigningStagedFiles `
    -StagingPath $context.StagingPath `
    -RequireComplete)
  [System.IO.Directory]::Move($context.StagingPath, $finalPath)
}

function Remove-AndroidReleaseSigningStagingDirectory {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string] $StagingDirectory,
    [Parameter(Mandatory = $true)][string] $ExpectedParentDirectory
  )

  $context = Get-AndroidReleaseSigningStagingContext `
    -StagingDirectory $StagingDirectory `
    -ExpectedParentDirectory $ExpectedParentDirectory
  if (!(Test-Path -LiteralPath $context.StagingPath)) {
    return
  }
  if (!(Test-Path -LiteralPath $context.StagingPath -PathType Container)) {
    throw "Release signing staging path is not a directory"
  }

  $validatedFiles = @(Get-ValidatedAndroidReleaseSigningStagedFiles `
    -StagingPath $context.StagingPath)
  foreach ($stagedFile in $validatedFiles) {
    [System.IO.File]::Delete($stagedFile)
  }

  $remainingEntries = @(
    [System.IO.Directory]::EnumerateFileSystemEntries($context.StagingPath)
  )
  if ($remainingEntries.Count -ne 0) {
    throw "Release signing staging directory contains an unexpected entry"
  }
  [System.IO.Directory]::Delete($context.StagingPath)
}

Export-ModuleMember -Function @(
  "Publish-AndroidReleaseSigningDirectory",
  "Remove-AndroidReleaseSigningStagingDirectory"
)
