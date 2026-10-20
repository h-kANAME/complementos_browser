$ErrorActionPreference = "Stop"
$source = $PSScriptRoot
$destRoot = Join-Path (Split-Path $source -Parent) "dist"
$stage = Join-Path $destRoot "muestrario-stage"
$zip = Join-Path $destRoot "muestrario.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

Get-ChildItem -Path $source -Force | Where-Object { $_.Name -ne "empaquetar.ps1" } | ForEach-Object {
  if ($_.Name -eq ".env") { return }
  Copy-Item $_.FullName -Destination (Join-Path $stage $_.Name) -Recurse -Force
}

$leaks = Get-ChildItem -Path $stage -Recurse -Force -File | Where-Object {
  $_.Name -eq ".env" -or ($_.Name -like ".env.*" -and $_.Name -ne ".env.example")
}
if ($leaks) {
  Remove-Item $stage -Recurse -Force
  throw "El paquete iba a incluir un .env. No se generó el zip."
}

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip
Remove-Item $stage -Recurse -Force
Write-Output "Listo: $zip"
