# Builds the portable Windows zip for Scoop (issue #48): the unpacked
# Paperling.exe plus any runtime DLLs the Tauri build dropped next to it,
# zipped as Paperling_<version>_x64-portable.zip.
#
# Usage: pwsh scripts/make-portable-zip.ps1 -ExeDir <path> -OutFile <zip path>
#   -ExeDir   the directory containing the built Paperling.exe, e.g.
#             src-tauri/target/x86_64-pc-windows-msvc/release
#   -OutFile  destination zip, e.g. dist/Paperling_1.0.50_x64-portable.zip
param(
    [Parameter(Mandatory = $true)][string]$ExeDir,
    [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = "Stop"

$exe = Join-Path $ExeDir "Paperling.exe"
if (-not (Test-Path $exe)) {
    throw "Paperling.exe not found in $ExeDir"
}

$stagingName = "paperling-portable-" + [guid]::NewGuid().ToString('N')
$staging = New-Item -ItemType Directory -Path (Join-Path $env:TEMP $stagingName) -Force
try {
    # The exe is self-contained for daily use (WebView2 ships with Windows);
    # any runtime DLLs the build emitted go along for the ride, just in case.
    Copy-Item $exe $staging.FullName
    Get-ChildItem $ExeDir -Filter "*.dll" | ForEach-Object {
        Copy-Item $_.FullName $staging.FullName
    }

    $outDir = Split-Path $OutFile -Parent
    if ($outDir) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
    Compress-Archive -Path (Join-Path $staging.FullName "*") -DestinationPath $OutFile -Force

    $zip = Get-Item $OutFile
    Write-Host "Portable zip created: $($zip.FullName) ($([math]::Round($zip.Length / 1MB, 1)) MB)"
} finally {
    Remove-Item $staging.FullName -Recurse -Force -ErrorAction SilentlyContinue
}
