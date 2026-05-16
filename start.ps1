# OneAPIChat Windows Quick Start
# Run locally: powershell -File start.ps1
# Or: Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; .\start.ps1

param([switch]$Detach)  # -Detach: start services and exit (for iex/remote use)

$REPO_DIR = "C:\Program Files\OneAPIChat"
$PHP_DIR = "C:\Program Files\PHP"
$PORT = 8080

Write-Host "OneAPIChat v3.0 Starting..." -ForegroundColor Cyan

# Find Python
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $python) { Write-Host "[ERROR] Python not found" -ForegroundColor Red; if (-not $Detach) { Read-Host "Press Enter" }; exit 1 }

# Find PHP
$phpExe = "$PHP_DIR\php.exe"
if (-not (Test-Path $phpExe)) { $phpExe = (Get-Command php -ErrorAction SilentlyContinue).Source }
if (-not $phpExe) { Write-Host "[ERROR] PHP not found" -ForegroundColor Red; if (-not $Detach) { Read-Host "Press Enter" }; exit 1 }

$env:Path = "$PHP_DIR;$env:Path"

# Kill old processes
Get-Process -Name "python*" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "engine_server" } | Stop-Process -Force
Get-Process -Name "php*" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "localhost:$PORT" } | Stop-Process -Force

# Start engine in its own hidden window (survives parent exit)
Write-Host "[INFO] Starting Python engine..." -ForegroundColor Blue
Start-Process -FilePath $python.Source -ArgumentList "$REPO_DIR\engine_server.py" -WorkingDirectory $REPO_DIR -WindowStyle Hidden
Write-Host "[OK] Engine started" -ForegroundColor Green

# Start PHP in its own hidden window
Write-Host "[INFO] Starting PHP on port $PORT..." -ForegroundColor Blue
Start-Process -FilePath $phpExe -ArgumentList "-S 0.0.0.0:$PORT -t `"$REPO_DIR`" `"$REPO_DIR\router.php`"" -WindowStyle Hidden
Write-Host "[OK] PHP server started" -ForegroundColor Green

# Open browser
Start-Sleep -Seconds 2
Start-Process "http://localhost:$PORT"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OneAPIChat v3.0 is running!" -ForegroundColor Cyan
Write-Host "  http://localhost:$PORT" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($Detach) {
    Write-Host "Services running in background. You can close this window." -ForegroundColor Green
} else {
    Write-Host "Ctrl+C to exit (services will keep running)" -ForegroundColor Green
    Write-Host ""
    try { while ($true) { Start-Sleep -Seconds 60 } } finally {}
}
