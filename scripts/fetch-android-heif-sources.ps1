[CmdletBinding()]
param(
  [string]$SourceCache,
  [string]$ArchiveDirectory,
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$lockPath = Join-Path $repositoryRoot 'android\native-deps\heif-lock.json'
$lock = Get-Content -Raw -Encoding UTF8 -LiteralPath $lockPath | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($SourceCache)) {
  $SourceCache = Join-Path $repositoryRoot 'android\.native-deps\heif-sources'
}
$SourceCache = [IO.Path]::GetFullPath($SourceCache)

if ($VerifyOnly -and ![string]::IsNullOrWhiteSpace($ArchiveDirectory)) {
  throw 'VerifyOnly cannot be combined with ArchiveDirectory.'
}

$archiveRoot = if ([string]::IsNullOrWhiteSpace($ArchiveDirectory)) {
  $null
} else {
  (Resolve-Path -LiteralPath $ArchiveDirectory).ProviderPath
}

function Test-ReparsePoint {
  param([IO.FileSystemInfo]$Item)
  return ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
}

function Assert-NoReparseSourceTree {
  param(
    [string]$Root,
    [string]$DependencyName
  )

  if (!(Test-Path -LiteralPath $Root -PathType Container)) {
    throw "Native source verification failed for ${DependencyName}: source directory is missing."
  }
  $rootItem = Get-Item -Force -LiteralPath $Root
  if (Test-ReparsePoint -Item $rootItem) {
    throw "Native source verification failed for ${DependencyName}: source tree contains a reparse point."
  }

  $directories = [Collections.Generic.Stack[IO.DirectoryInfo]]::new()
  $directories.Push($rootItem)
  while ($directories.Count -gt 0) {
    $directory = $directories.Pop()
    foreach ($item in Get-ChildItem -Force -LiteralPath $directory.FullName) {
      if (Test-ReparsePoint -Item $item) {
        throw "Native source verification failed for ${DependencyName}: source tree contains a reparse point."
      }
      if ($item.PSIsContainer) {
        $directories.Push($item)
      }
    }
  }
}

function Get-SafeSourceFiles {
  param(
    [string]$Root,
    [string]$DependencyName
  )

  Assert-NoReparseSourceTree -Root $Root -DependencyName $DependencyName
  $rootPrefix = [IO.Path]::GetFullPath($Root).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
  return @(Get-ChildItem -Force -LiteralPath $Root -Recurse -File | Where-Object {
    $_.Name -cne '.hongtai-source-lock.json'
  } | ForEach-Object {
    [pscustomobject]@{
      File = $_
      Relative = $_.FullName.Substring($rootPrefix.Length).Replace('\', '/')
    }
  })
}

function Get-SourceTreeHash {
  param(
    [string]$Root,
    [string]$DependencyName
  )
  $files = @(Get-SafeSourceFiles -Root $Root -DependencyName $DependencyName)
  $records = [Collections.Generic.List[string]]::new()
  foreach ($entry in $files) {
    $currentFile = Get-Item -Force -LiteralPath $entry.File.FullName
    if (Test-ReparsePoint -Item $currentFile) {
      throw "Native source verification failed for ${DependencyName}: source tree contains a reparse point."
    }
    $fileHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $currentFile.FullName).Hash.ToLowerInvariant()
    $fileLength = $currentFile.Length.ToString([Globalization.CultureInfo]::InvariantCulture)
    [void]$records.Add($entry.Relative + '|' + $fileLength + '|' + $fileHash)
  }
  $records.Sort([StringComparer]::Ordinal)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $manifest = [Text.StringBuilder]::new()
    foreach ($record in $records) {
      [void]$manifest.Append($record).Append([char]10)
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes($manifest.ToString())
    return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function Assert-PublishedSource {
  param(
    [string]$Target,
    [object]$Dependency,
    [string]$DependencyName
  )
  if (!(Test-Path -LiteralPath $Target -PathType Container)) {
    throw "Native source verification failed for ${DependencyName}: source directory is missing."
  }
  $markerPath = Join-Path $Target '.hongtai-source-lock.json'
  if (!(Test-Path -LiteralPath $markerPath -PathType Leaf)) {
    throw "Native source verification failed for ${DependencyName}: source marker is missing."
  }
  $markerItem = Get-Item -Force -LiteralPath $markerPath
  if (Test-ReparsePoint -Item $markerItem) {
    throw "Native source verification failed for ${DependencyName}: source tree contains a reparse point."
  }
  try {
    $marker = Get-Content -Raw -Encoding UTF8 -LiteralPath $markerPath | ConvertFrom-Json
  } catch {
    throw "Native source verification failed for ${DependencyName}: source marker is invalid."
  }
  $requiredMarkerFields = @('commit', 'archiveSha256', 'sourceTreeSha256', 'patchSetSha256')
  foreach ($field in $requiredMarkerFields) {
    if ($null -eq $marker.PSObject.Properties[$field]) {
      throw "Native source verification failed for ${DependencyName}: source marker mismatch."
    }
  }
  if ($marker.commit -cne $Dependency.commit -or
    $marker.archiveSha256 -cne $Dependency.archiveSha256 -or
    $marker.sourceTreeSha256 -cne $Dependency.sourceTreeSha256 -or
    $marker.patchSetSha256 -cne $lock.patchSetSha256) {
    throw "Native source verification failed for ${DependencyName}: source marker mismatch."
  }
  if ((Get-SourceTreeHash -Root $Target -DependencyName $DependencyName) -cne $Dependency.sourceTreeSha256) {
    throw "Native source verification failed for ${DependencyName}: source tree hash mismatch."
  }
}

function Test-PublishedSource {
  param(
    [string]$Target,
    [object]$Dependency,
    [string]$DependencyName
  )
  try {
    Assert-PublishedSource -Target $Target -Dependency $Dependency -DependencyName $DependencyName
    return $true
  } catch {
    return $false
  }
}

function Assert-SafeArchive {
  param([string]$Archive, [string]$ExpectedRoot)
  $entries = @(& $tar -tf $Archive)
  if ($LASTEXITCODE -ne 0 -or $entries.Count -eq 0) { throw "Native source archive could not be listed safely." }
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($rawEntry in $entries) {
    $entry = ([string]$rawEntry).Replace('\', '/').TrimEnd('/')
    if ([string]::IsNullOrWhiteSpace($entry) -or $entry.StartsWith('/') -or $entry -match '^[A-Za-z]:' -or
      $entry.Split('/') -contains '..') {
      throw "Native source archive contains an unsafe path."
    }
    if ($entry.Split('/')[0] -cne $ExpectedRoot) {
      throw "Native source archive has an unexpected revision root."
    }
    if (!$seen.Add($entry)) { throw "Native source archive contains a duplicate path." }
  }
  $verboseEntries = @(& $tar -tvf $Archive)
  if ($LASTEXITCODE -ne 0) { throw "Native source archive types could not be inspected safely." }
  if ($verboseEntries | Where-Object { $_ -match '^[lh]' }) {
    throw "Native source archive contains a link entry."
  }
}

if ($VerifyOnly) {
  foreach ($property in $lock.dependencies.PSObject.Properties) {
    $name = $property.Name
    $dependency = $property.Value
    if (Test-Path -LiteralPath $SourceCache -PathType Container) {
      $cacheRoot = Get-Item -Force -LiteralPath $SourceCache
      if (Test-ReparsePoint -Item $cacheRoot) {
        throw "Native source verification failed for ${name}: source tree contains a reparse point."
      }
    }
    $target = Join-Path $SourceCache $dependency.archiveRoot
    Assert-PublishedSource -Target $target -Dependency $dependency -DependencyName $name
    Write-Output "$name source verified: $($dependency.commit)"
  }
  return
}

$tar = (Get-Command 'tar.exe' -ErrorAction Stop).Source
New-Item -ItemType Directory -Force -Path $SourceCache | Out-Null

foreach ($property in $lock.dependencies.PSObject.Properties) {
  $name = $property.Name
  $dependency = $property.Value
  $target = Join-Path $SourceCache $dependency.archiveRoot
  $archive = $null
  $downloaded = $null
  $staging = $null
  try {
    if ($archiveRoot) {
      $archive = Join-Path $archiveRoot $dependency.archiveFileName
      if (!(Test-Path -LiteralPath $archive -PathType Leaf)) {
        throw "Offline archive is missing for $name."
      }
    } elseif (Test-PublishedSource -Target $target -Dependency $dependency -DependencyName $name) {
      Write-Output "$name source already verified: $($dependency.commit)"
      continue
    } else {
      $downloaded = Join-Path ([IO.Path]::GetTempPath()) ("hongtai-$name-" + [guid]::NewGuid().ToString('N') + '.tar.gz')
      Invoke-WebRequest -UseBasicParsing -Uri $dependency.url -OutFile $downloaded
      $archive = $downloaded
    }

    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
    if ($actualHash -cne $dependency.archiveSha256) {
      throw "Native source archive hash mismatch for $name."
    }
    Assert-SafeArchive -Archive $archive -ExpectedRoot $dependency.archiveRoot

    if (Test-PublishedSource -Target $target -Dependency $dependency -DependencyName $name) {
      Write-Output "$name archive and source already verified: $($dependency.commit)"
      continue
    }
    if (Test-Path -LiteralPath $target) {
      throw "Native source cache exists but does not match the pinned lock for $name."
    }

    $staging = Join-Path $SourceCache ('.staging-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $staging | Out-Null
    & $tar -xf $archive -C $staging
    if ($LASTEXITCODE -ne 0) { throw "Native source archive extraction failed for $name." }
    $extracted = Join-Path $staging $dependency.archiveRoot
    if (!(Test-Path -LiteralPath (Join-Path $extracted 'CMakeLists.txt') -PathType Leaf)) {
      throw "Native source revision marker is missing for $name."
    }
    $sourceTreeHash = Get-SourceTreeHash -Root $extracted -DependencyName $name
    if ($sourceTreeHash -cne $dependency.sourceTreeSha256) {
      throw "Extracted native source tree hash mismatch for $name (expected $($dependency.sourceTreeSha256), got $sourceTreeHash)."
    }
    [ordered]@{
      commit = $dependency.commit
      archiveSha256 = $dependency.archiveSha256
      sourceTreeSha256 = $sourceTreeHash
      patchSetSha256 = $lock.patchSetSha256
    } | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $extracted '.hongtai-source-lock.json')
    Move-Item -LiteralPath $extracted -Destination $target
    Write-Output "$name source published: $($dependency.commit)"
  } finally {
    if ($staging -and (Test-Path -LiteralPath $staging)) {
      Remove-Item -LiteralPath $staging -Recurse -Force
    }
    if ($downloaded -and (Test-Path -LiteralPath $downloaded)) {
      Remove-Item -LiteralPath $downloaded -Force
    }
  }
}
