$ErrorActionPreference = "Stop"

Write-Output "Node: $(node --version)"
Write-Output "pnpm: $(pnpm --version)"

if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
    Write-Output "FFmpeg: available"
} else {
    Write-Output "FFmpeg: not configured (allowed during skeleton stage)"
}

Write-Output "Environment check completed."

