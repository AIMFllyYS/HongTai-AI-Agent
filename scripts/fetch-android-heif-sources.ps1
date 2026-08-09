[CmdletBinding()]
param(
  [string]$SourceCache,
  [string]$ArchiveDirectory
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
$archiveRoot = if ([string]::IsNullOrWhiteSpace($ArchiveDirectory)) {
  $null
} else {
  (Resolve-Path -LiteralPath $ArchiveDirectory).ProviderPath
}
$tar = (Get-Command 'tar.exe' -ErrorAction Stop).Source
New-Item -ItemType Directory -Force -Path $SourceCache | Out-Null

function Get-SourceTreeHash {
  param([string]$Root)
  $rootPrefix = [IO.Path]::GetFullPath($Root).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
  $files = @(Get-ChildItem -LiteralPath $Root -Recurse -File | Where-Object {
    $_.Name -cne '.hongtai-source-lock.json'
  } | ForEach-Object {
    [pscustomobject]@{
      File = $_
      Relative = $_.FullName.Substring($rootPrefix.Length).Replace('\', '/')
    }
  })
  $records = [Collections.Generic.List[string]]::new()
  foreach ($entry in $files) {
    $fileHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $entry.File.FullName).Hash.ToLowerInvariant()
    $fileLength = $entry.File.Length.ToString([Globalization.CultureInfo]::InvariantCulture)
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

function Test-PublishedSource {
  param([string]$Target, [object]$Dependency)
  $markerPath = Join-Path $Target '.hongtai-source-lock.json'
  if (!(Test-Path -LiteralPath $markerPath -PathType Leaf)) { return $false }
  $marker = Get-Content -Raw -Encoding UTF8 -LiteralPath $markerPath | ConvertFrom-Json
  return $marker.commit -ceq $Dependency.commit -and
    $marker.archiveSha256 -ceq $Dependency.archiveSha256 -and
    $marker.sourceTreeSha256 -ceq $Dependency.sourceTreeSha256 -and
    $marker.patchSetSha256 -ceq $lock.patchSetSha256 -and
    (Get-SourceTreeHash -Root $Target) -ceq $Dependency.sourceTreeSha256
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
    } elseif (Test-PublishedSource -Target $target -Dependency $dependency) {
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

    if (Test-PublishedSource -Target $target -Dependency $dependency) {
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
    $sourceTreeHash = Get-SourceTreeHash -Root $extracted
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
