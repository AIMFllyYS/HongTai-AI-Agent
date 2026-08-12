[CmdletBinding()]
param(
  [string] $SigningDirectory = (Join-Path $env:APPDATA "HongTai-AI-Agent\signing")
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
    $keytool = Join-Path $candidate "bin\keytool.exe"
    if (!(Test-Path -LiteralPath $java -PathType Leaf) -or
        !(Test-Path -LiteralPath $keytool -PathType Leaf)) {
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

function New-RandomSecret {
  $bytes = New-Object byte[] 48
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Invoke-KeytoolSilently {
  param(
    [Parameter(Mandatory = $true)][string] $Command,
    [Parameter(Mandatory = $true)][string[]] $Arguments,
    [Parameter(Mandatory = $true)][string] $FailureMessage
  )

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & $Command @Arguments 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw $FailureMessage
    }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function Protect-SigningDirectory {
  param([Parameter(Mandatory = $true)][string] $Path)

  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowedSids = @($currentSid, "S-1-5-18", "S-1-5-32-544")
  $icacls = Join-Path $env:SystemRoot "System32\icacls.exe"
  & $icacls @(
    $Path,
    "/inheritance:r",
    "/grant:r",
    "*${currentSid}:(OI)(CI)F",
    "*S-1-5-18:(OI)(CI)F",
    "*S-1-5-32-544:(OI)(CI)F"
  ) | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to restrict the release signing directory ACL"
  }

  $unexpectedAcl = (Get-Acl -LiteralPath $Path).Access | Where-Object {
    $sid = $_.IdentityReference.Translate(
      [System.Security.Principal.SecurityIdentifier]
    ).Value
    $allowedSids -notcontains $sid
  }
  if ($null -ne $unexpectedAcl) {
    throw "Release signing directory ACL contains an unexpected identity"
  }
}

$rawRepositoryRoot = Join-Path $PSScriptRoot ".."
Assert-NoReparsePoint -Path $rawRepositoryRoot `
  -FailureMessage "Repository path must not traverse a reparse point"
$repositoryRoot = Resolve-CanonicalPath -Path $rawRepositoryRoot
Import-Module (Join-Path $PSScriptRoot "android-release-signing-transaction.psm1") -Force

Assert-NoReparsePoint -Path $SigningDirectory `
  -FailureMessage "Release signing directory must not traverse a reparse point"
$resolvedSigningDirectory = Resolve-CanonicalPath -Path $SigningDirectory
if (Test-PathInsideRepository -CandidatePath $resolvedSigningDirectory -RepositoryRoot $repositoryRoot) {
  throw "Release signing directory must be outside the repository"
}
if (Test-Path -LiteralPath $resolvedSigningDirectory) {
  throw "Release signing directory must not already exist"
}

$signingParentDirectory = [System.IO.Path]::GetDirectoryName($resolvedSigningDirectory)
if ([string]::IsNullOrWhiteSpace($signingParentDirectory)) {
  throw "Release signing directory must have a filesystem parent"
}
Assert-NoReparsePoint -Path $signingParentDirectory `
  -FailureMessage "Release signing directory must not traverse a reparse point"
[void] [System.IO.Directory]::CreateDirectory($signingParentDirectory)
Assert-NoReparsePoint -Path $signingParentDirectory `
  -FailureMessage "Release signing directory must not traverse a reparse point"
if (Test-Path -LiteralPath $resolvedSigningDirectory) {
  throw "Release signing directory must not already exist"
}

$keystorePath = Join-Path $resolvedSigningDirectory "hongtai-release.jks"
$propertiesPath = Join-Path $resolvedSigningDirectory "keystore.properties"
$certificatePath = Join-Path $resolvedSigningDirectory "hongtai-release.cer"
$stagingDirectory = Join-Path $signingParentDirectory (
  ".signing.{0}.staging" -f [Guid]::NewGuid().ToString("N")
)
$stagedKeystore = Join-Path $stagingDirectory "hongtai-release.jks"
$stagedProperties = Join-Path $stagingDirectory "keystore.properties"
$stagedCertificate = Join-Path $stagingDirectory "hongtai-release.cer"
$storePasswordVariable = "HONGTAI_KEYTOOL_STORE_PASSWORD"
$keyPasswordVariable = "HONGTAI_KEYTOOL_KEY_PASSWORD"
$storePassword = $null
$keyPassword = $null
$properties = $null
$forwardSlashKeystore = $null

try {
  [void] [System.IO.Directory]::CreateDirectory($stagingDirectory)
  Protect-SigningDirectory -Path $stagingDirectory

  $jdkHome = Get-Jdk21Home
  $keytool = Join-Path $jdkHome "bin\keytool.exe"
  $storePassword = New-RandomSecret
  $keyPassword = New-RandomSecret
  [Environment]::SetEnvironmentVariable($storePasswordVariable, $storePassword, "Process")
  [Environment]::SetEnvironmentVariable($keyPasswordVariable, $keyPassword, "Process")

  Invoke-KeytoolSilently -Command $keytool -Arguments @(
    "-genkeypair",
    "-keystore", $stagedKeystore,
    "-storetype", "JKS",
    "-alias", "hongtai-release",
    "-keyalg", "RSA",
    "-keysize", "3072",
    "-sigalg", "SHA256withRSA",
    "-validity", "10000",
    "-dname", "CN=HongTai AI Agent Release,O=HongTai AI Agent,C=CN",
    "-storepass:env", $storePasswordVariable,
    "-keypass:env", $keyPasswordVariable,
    "-noprompt"
  ) -FailureMessage "keytool failed to generate the release signing identity"

  Invoke-KeytoolSilently -Command $keytool -Arguments @(
    "-exportcert",
    "-keystore", $stagedKeystore,
    "-storetype", "JKS",
    "-alias", "hongtai-release",
    "-storepass:env", $storePasswordVariable,
    "-file", $stagedCertificate
  ) -FailureMessage "keytool failed to export the public release certificate"

  $forwardSlashKeystore = $keystorePath.Replace('\', '/')
  $properties = @(
    "storeFile=$forwardSlashKeystore",
    "storePassword=$storePassword",
    "keyAlias=hongtai-release",
    "keyPassword=$keyPassword",
    ""
  ) -join "`n"
  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($stagedProperties, $properties, $utf8WithoutBom)

  foreach ($stagedFile in @($stagedKeystore, $stagedProperties, $stagedCertificate)) {
    if (!(Test-Path -LiteralPath $stagedFile -PathType Leaf) -or
        (Get-Item -Force -LiteralPath $stagedFile).Length -eq 0) {
      throw "Release signing staging directory is incomplete"
    }
  }
  $fingerprint = (
    Get-FileHash -LiteralPath $stagedCertificate -Algorithm SHA256
  ).Hash.ToLowerInvariant()
  if ($fingerprint -notmatch '^[0-9a-f]{64}$') {
    throw "Release signing certificate fingerprint is invalid"
  }

  Publish-AndroidReleaseSigningDirectory `
    -StagingDirectory $stagingDirectory `
    -FinalDirectory $resolvedSigningDirectory `
    -ExpectedParentDirectory $signingParentDirectory
  Write-Output "Signing properties: $propertiesPath"
  Write-Output "Certificate SHA-256: $fingerprint"
} finally {
  [Environment]::SetEnvironmentVariable($storePasswordVariable, $null, "Process")
  [Environment]::SetEnvironmentVariable($keyPasswordVariable, $null, "Process")
  $properties = $null
  $forwardSlashKeystore = $null
  $storePassword = $null
  $keyPassword = $null
  if (Test-Path -LiteralPath $stagingDirectory) {
    Remove-AndroidReleaseSigningStagingDirectory `
      -StagingDirectory $stagingDirectory `
      -ExpectedParentDirectory $signingParentDirectory
  }
}
