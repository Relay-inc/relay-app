# Builds Relay for Windows x64 on this Windows machine: Relay_<version>_x64-setup.exe, the NSIS installer (per user,
# no admin). Run it in the repo, in PowerShell: scripts\release-windows.ps1. Then copy the setup.exe to the Mac and
# run RELAY_WINDOWS_SETUP=/path/to/the.exe scripts/release.sh there (docs/development.md › Releasing for Windows).
# Needs: Visual Studio Build Tools with the C++ workload, cmake, LLVM (libclang), Node, pnpm and Rust (stable, MSVC).
# This script makes no updater signature: release.sh makes it on the Mac, where the updater key lives.
# Authenticode signing is off unless WINDOWS_SIGN is `azure` or `pfx` (docs/development.md › Signing), with the
# variables that page lists in the environment.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
# whisper.cpp for any x64 CPU with AVX2, not only this machine's (docs/development.md › Windows)
$env:GGML_NATIVE = 'OFF'

pnpm install --frozen-lockfile
if ($LASTEXITCODE) { throw 'pnpm install failed' }

# the build's own config on top of tauri.conf.json and tauri.windows.conf.json: no updater artifacts and, once
# switched on, the Authenticode signature of relay.exe, the installer and its uninstaller
$win = @{}
switch ($env:WINDOWS_SIGN) {
  'azure' {
    cargo install artifact-signing-cli --locked
    $win.signCommand = "artifact-signing-cli -e $env:AZURE_SIGNING_ENDPOINT -a $env:AZURE_SIGNING_ACCOUNT -c $env:AZURE_SIGNING_PROFILE -d Relay %1"
  }
  'pfx' {
    $pfx = Join-Path $env:TEMP relay.pfx
    [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE))
    $pw = ConvertTo-SecureString $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force
    $win.certificateThumbprint = (Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\CurrentUser\My -Password $pw).Thumbprint
    Remove-Item $pfx
    $win.digestAlgorithm = 'sha256'
    $win.timestampUrl = $env:WINDOWS_TIMESTAMP_URL
  }
  default {
    if ($env:WINDOWS_SIGN) { throw "WINDOWS_SIGN is '$env:WINDOWS_SIGN', not azure or pfx" }
    'Authenticode signing is off: the installer is unsigned'
  }
}
$conf = Join-Path $env:TEMP relay-windows.conf.json
@{ bundle = @{ createUpdaterArtifacts = $false; windows = $win } } | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8NoBOM $conf

pnpm tauri build --bundles nsis --config $conf
if ($LASTEXITCODE) { throw 'tauri build failed' }

$setup = Get-ChildItem target\release\bundle\nsis\*-setup.exe | Select-Object -First 1
if (-not $setup) { throw 'no setup.exe in target\release\bundle\nsis' }
"Built $($setup.FullName)"
