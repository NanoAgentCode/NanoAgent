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

  # vcvars64.bat 仅在 cmd 上下文有效，先在 cmd 中采集完整的 MSVC 环境。
  $envDump = & cmd.exe /d /s /c ('"' + $VcVars + '" && set')
  $msvcEnv = @{}
  foreach ($line in $envDump) {
    $idx = $line.IndexOf('=')
    if ($idx -gt 0) {
      $msvcEnv[$line.Substring(0, $idx)] = $line.Substring($idx + 1)
    }
  }

  # 关键修复：Git for Windows 的 /usr/bin/link.exe 会抢占 MSVC 的 link.exe，
  # 导致 Rust 链接失败（报 "/usr/bin/link: missing operand"）。这里在 PATH
  # 最前面加上 MSVC、SDK 与 cargo，并移除任何 Git\usr\bin / Git\mingw...\bin。
  $cleanPath = $msvcEnv['PATH']
  $cargoHome = $env:CARGO_HOME; if (-not $cargoHome) { $cargoHome = Join-Path $env:USERPROFILE '.cargo' }
  $cargoBin = Join-Path $cargoHome 'bin'
  $segments = $cleanPath -split ';' | Where-Object {
    $_ -and ($_) -notmatch 'Git[\\/]+(usr|mingw\d+)[\\/]+bin' -and $_ -ne $cargoBin
  }
  $msvcEnv['PATH'] = (@($cargoBin) + $segments) -join ';'
  foreach ($key in $msvcEnv.Keys) { Set-Item -Path ('Env:' + $key) -Value $msvcEnv[$key] }

  Write-Host "==> Using linker: $((Get-Command link.exe -ErrorAction SilentlyContinue).Source)"

  & cmd.exe /d /s /c 'npm.cmd run tauri build'

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
