param(
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoRoot "src-tauri\Cargo.toml"
$sourceExe = Join-Path $repoRoot "src-tauri\target\release\nano.exe"
$cargoCommand = Get-Command cargo -ErrorAction Stop
if (-not $InstallDir) {
  $InstallDir = Split-Path -Parent $cargoCommand.Source
}

Write-Host "==> Building nano"
& $cargoCommand.Source build --release --bin nano --manifest-path $manifestPath
if ($LASTEXITCODE -ne 0) {
  throw "cargo build failed with exit code $LASTEXITCODE"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$destination = Join-Path $InstallDir "nano.exe"
Copy-Item -LiteralPath $sourceExe -Destination $destination -Force

$pathEntries = @($env:Path -split ";" | Where-Object { $_.Trim() })
$onPath = $pathEntries | Where-Object {
  $_.TrimEnd("\") -ieq $InstallDir.TrimEnd("\")
}
if (-not $onPath) {
  throw "$InstallDir is not on the current PATH; rerun with -InstallDir pointing to a user-writable PATH directory"
}

Write-Host "==> Installed $destination"
Write-Host "Run: nano --help"
