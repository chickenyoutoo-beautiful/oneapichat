# OneAPIChat Windows Quick Start
# Run: powershell -File start.ps1
# Or in repo dir just: .\start.ps1

$REPO_DIR = "C:\Program Files\OneAPIChat"
$PHP_DIR = "C:\Program Files\PHP"
$PORT = 8080

Write-Host "OneAPIChat v3.0 Starting..." -ForegroundColor Cyan

# Find Python
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $python) { Write-Host "[ERROR] Python not found" -ForegroundColor Red; exit 1 }

# Find PHP
$phpExe = "$PHP_DIR\php.exe"
if (-not (Test-Path $phpExe)) {
    $phpExe = (Get-Command php -ErrorAction SilentlyContinue).Source
}
if (-not $phpExe) { Write-Host "[ERROR] PHP not found at $PHP_DIR" -ForegroundColor Red; exit 1 }

# Add PHP to PATH
$env:Path = "C:\Program Files\PHP;$env:Path"

# Stop existing processes
Get-Process -Name "python*" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "engine_server" } | Stop-Process -Force
Get-Process -Name "php*" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "localhost:$PORT" } | Stop-Process -Force

# Start Python backend engine
Write-Host "[INFO] Starting Python backend engine..." -ForegroundColor Blue
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $python.Source
$psi.Arguments = "$REPO_DIR\engine_server.py"
$psi.WorkingDirectory = $REPO_DIR
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$p = [System.Diagnostics.Process]::Start($psi)
Write-Host "[OK] Engine started (PID: $($p.Id))" -ForegroundColor Green

# Start PHP built-in server
Write-Host "[INFO] Starting PHP server on port $PORT..." -ForegroundColor Blue
$psi2 = New-Object System.Diagnostics.ProcessStartInfo
$psi2.FileName = $phpExe
$psi2.Arguments = "-S 0.0.0.0:$PORT -t $REPO_DIR"
$psi2.WorkingDirectory = $REPO_DIR
$psi2.UseShellExecute = $false
$psi2.CreateNoWindow = $true
$p2 = [System.Diagnostics.Process]::Start($psi2)
Write-Host "[OK] PHP server started (PID: $($p2.Id))" -ForegroundColor Green

# Open browser
Start-Sleep -Seconds 2
Start-Process "http://localhost:$PORT"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OneAPIChat is running!" -ForegroundColor Cyan
Write-Host "  http://localhost:$PORT" -ForegroundColor Cyan
Write-Host "  To stop: close this window" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Keep window open
Read-Host "Press Enter to exit (services keep running in background)"
