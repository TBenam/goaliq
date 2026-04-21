$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'

if (-not (Test-Path $backend)) {
  throw "Backend introuvable: $backend"
}

Write-Host "GoalIQ - lancement des services..." -ForegroundColor Cyan
Write-Host "Racine   : $root"
Write-Host "Backend  : $backend"

$frontendCmd = "Set-Location '$root'; python -m http.server 5500"
$apiCmd = "Set-Location '$backend'; node server.js"

Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-Command', $frontendCmd
Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-Command', $apiCmd

Write-Host ""
Write-Host "Services lancés :" -ForegroundColor Green
Write-Host " - Frontend  : http://localhost:5500"
Write-Host " - API       : http://localhost:3001/api/health"
Write-Host " - Scheduler : deja embarque dans l'API"
Write-Host ""
Write-Host "Si vous êtes déjà dans goaliq-pwa, utilisez aussi ces commandes simples :" -ForegroundColor Yellow
Write-Host " - npm run api"
Write-Host " - npm run frontend"
Write-Host ""
Write-Host "Note: ne lancez 'npm run scheduler' que si vous voulez un processus pipeline separe." -ForegroundColor DarkYellow
