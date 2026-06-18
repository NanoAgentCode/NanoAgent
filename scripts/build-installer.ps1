$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$VcVars = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

if (-not (Test-Path -LiteralPath $VcVars)) {
  throw "Visual Studio Build Tools was not found: $VcVars"
}

Push-Location $Root
try {
  Write-Host "==> Building NanoAgent installer"
  Write-Host "==> Workspace: $Root"

  $cmd = '"' + $VcVars + '" && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm.cmd run tauri build'
  & cmd.exe /d /s /c $cmd

  if ($LASTEXITCODE -ne 0) {
    throw "Tauri build failed. Exit code: $LASTEXITCODE"
  }

  $BundleDir = Join-Path $Root "src-tauri\target\release\bundle"
  $Nsis = Get-ChildItem -LiteralPath (Join-Path $BundleDir "nsis") -Filter "*.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $Msi = Get-ChildItem -LiteralPath (Join-Path $BundleDir "msi") -Filter "*.msi" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1

  Write-Host ""
  Write-Host "==> Build completed"
  if ($Nsis) {
    Write-Host "NSIS: $($Nsis.FullName)"
  }
  if ($Msi) {
    Write-Host "MSI : $($Msi.FullName)"
  }
} finally {
  Pop-Location
}
