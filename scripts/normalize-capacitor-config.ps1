[CmdletBinding()]
param(
  [string] $ConfigPath = (
    Join-Path $PSScriptRoot "..\android\app\src\main\res\xml\config.xml"
  )
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$resolvedConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)
if ([System.IO.Path]::GetFileName($resolvedConfigPath) -cne "config.xml") {
  throw "Capacitor config normalizer only accepts config.xml"
}
if (!(Test-Path -LiteralPath $resolvedConfigPath -PathType Leaf)) {
  throw "Capacitor generated config.xml is required"
}

$strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
try {
  $content = $strictUtf8.GetString(
    [System.IO.File]::ReadAllBytes($resolvedConfigPath)
  )
} catch {
  throw "Capacitor generated config.xml must be valid UTF-8"
}
if ($content.Length -gt 0 -and $content[0] -eq [char] 0xFEFF) {
  $content = $content.Substring(1)
}

$normalizedLines = New-Object 'System.Collections.Generic.List[string]'
foreach ($line in [regex]::Split($content, "`r`n|`n|`r")) {
  $trimmedLine = $line.TrimEnd([char[]] @(' ', "`t"))
  if ($trimmedLine.Length -gt 0) {
    [void] $normalizedLines.Add($trimmedLine)
  }
}
if ($normalizedLines.Count -eq 0) {
  throw "Capacitor generated config.xml must not be empty"
}

$normalizedContent = [string]::Join("`n", $normalizedLines) + "`n"
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
  $resolvedConfigPath,
  $normalizedContent,
  $utf8WithoutBom
)
