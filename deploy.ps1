<#
.SYNOPSIS
    OneAPIChat Windows Installer — one-click deploy for native Windows.
.DESCRIPTION
    Installs PHP, Python, starts the backend engine and PHP built-in server.
    Run this script in PowerShell as Administrator.
.EXAMPLE
    .\deploy.ps1
#>

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "OneAPIChat Installer"

$GREEN = "Green"
$YELLOW = "Yellow"
$RED = "Red"
$CYAN = "Cyan"

Write-Host "========================================" -ForegroundColor $CYAN
Write-Host "  OneAPIChat v3.0 部署脚本" -ForegroundColor $CYAN
Write-Host "  预计耗时: 1-3 分钟（视网络状况）" -ForegroundColor $CYAN
Write-Host "========================================" -ForegroundColor $CYAN

function Write-Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor $CYAN }
function Write-OK($msg) { Write-Host "[OK] $msg" -ForegroundColor $GREEN }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor $YELLOW }
function Write-Error($msg) { Write-Host "[ERROR] $msg" -ForegroundColor $RED; exit 1 }

# ── Check admin rights ──────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin) {
    Write-Warn "需要管理员权限运行。请右键 PowerShell → 以管理员身份运行"
    Write-Info "或运行: Start-Process powershell -Verb RunAs -ArgumentList '-File $($MyInvocation.MyCommand.Path)'"
    exit 1
}

# ── Detect whether we're in repo dir ──────────────
$REPO_URL = "https://github.com/chickenyoutoo-beautiful/oneapichat.git"
$INSTALL_DIR = "$env:ProgramFiles\OneAPIChat"

if ((Test-Path ".\index.html") -and (Test-Path ".\engine_server.py")) {
    $REPO_DIR = (Get-Location).Path
    Write-Info "已在仓库目录: $REPO_DIR"
} elseif (Test-Path "$INSTALL_DIR\index.html") {
    $REPO_DIR = $INSTALL_DIR
    Write-Info "仓库已存在: $REPO_DIR"
} else {
    $REPO_DIR = $INSTALL_DIR
    Write-Info "克隆仓库到 $INSTALL_DIR ..."
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Info "正在安装 Git for Windows..."
        winget install --id Git.Git -e --source winget 2>$null | Out-Null
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine")
    }
    git clone --depth 1 $REPO_URL $INSTALL_DIR 2>&1 | Out-Null
    if (-not $?) { Write-Error "克隆失败，请检查网络" }
    Write-OK "仓库已克隆"
}
Set-Location $REPO_DIR

# ── Install PHP ──────────────────────────────────────
$phpPath = $null

# 直接按已知路径搜 php.exe，不读 PATH（避免网络路径超时）
$knownPaths = @(
    "C:\Program Files\PHP\php.exe",
    "C:\Program Files\PHP\v8.3\php.exe",
    "C:\Program Files\PHP\v8.4\php.exe",
    "C:\php\php.exe",
    "C:\tools\php\php.exe",
    "C:\tools\php\v8.3\php.exe",
    "C:\tools\php\v8.4\php.exe",
    "$env:ProgramFiles\PHP\php.exe",
    "$env:ProgramFiles\PHP\v8.3\php.exe",
    "$env:ProgramFiles\PHP\v8.4\php.exe"
)
foreach ($p in $knownPaths) {
    if (Test-Path $p) { $phpPath = $p; break }
}

# 没命中就轻量搜常用目录
if (-not $phpPath) {
    $roots = @("C:\Program Files", "C:\Program Files (x86)", "C:\tools")
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $found = Get-ChildItem -Path $root -Filter "php.exe" -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { $phpPath = $found.FullName; break }
    }
}

if ($phpPath) {
    Write-OK "找到 PHP: $phpPath"
} else {
    # winget 安装
    Write-Info "正在安装 PHP（winget，约 1 分钟）..."
    winget install --id PHP.PHP -e --source winget --accept-package-agreements 2>&1
    Write-Info "winget 完成"

    # 装完再搜
    $roots = @("C:\Program Files", "C:\Program Files (x86)", "C:\tools")
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $found = Get-ChildItem -Path $root -Filter "php.exe" -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { $phpPath = $found.FullName; break }
    }

    if (-not $phpPath) {
        # 下载
        Write-Info "下载 PHP（约 30MB）..."
        $phpUrl = "https://windows.php.net/downloads/releases/archives/php-8.3.29-nts-Win32-vs16-x64.zip"
        $phpZip = "$env:TEMP\php.zip"
        $phpDir = "C:\php"
        Invoke-WebRequest -Uri $phpUrl -OutFile $phpZip -UseBasicParsing
        Write-Info "解压中..."
        New-Item -ItemType Directory -Force -Path $phpDir | Out-Null
        Expand-Archive -Path $phpZip -DestinationPath $phpDir -Force
        $phpPath = "$phpDir\php.exe"
        Remove-Item $phpZip -Force -ErrorAction SilentlyContinue
    }

    if (-not $phpPath) {
        Write-Error "无法安装 PHP。请手动下载: https://windows.php.net/download"
    }
    Write-OK "PHP 已就绪: $phpPath"
}

# 注册到 PATH 并配置 php.ini
$phpDir = Split-Path $phpPath -Parent
Add-MachinePathItem $phpDir
$env:Path = "$phpDir;$env:Path"
$iniPath = "$phpDir\php.ini"
if (-not (Test-Path $iniPath)) {
    if (Test-Path "$phpDir\php.ini-development") { Copy-Item "$phpDir\php.ini-development" $iniPath -Force }
    elseif (Test-Path "$phpDir\php.ini-production") { Copy-Item "$phpDir\php.ini-production" $iniPath -Force }
}
if (Test-Path $iniPath) {
    $ini = Get-Content $iniPath -Raw
    $ini = $ini -replace ';extension=curl', 'extension=curl'
    $ini = $ini -replace ';extension=mbstring', 'extension=mbstring'
    $ini = $ini -replace ';extension=openssl', 'extension=openssl'
    $ini = $ini -replace ';extension=pdo_sqlite', 'extension=pdo_sqlite'
    $ini = $ini -replace ';extension=sqlite3', 'extension=sqlite3'
    $ini = $ini -replace ';extension_dir = "ext"', 'extension_dir = "ext"'
    $ini = $ini -replace ';date.timezone =', 'date.timezone = Asia/Shanghai'
    Set-Content $iniPath $ini
}

# ── Install Python ──────────────────────────────────
if (-not (Get-Command python -ErrorAction SilentlyContinue) -and
    -not (Get-Command python3 -ErrorAction SilentlyContinue)) {
    Write-Info "正在安装 Python 3.12..."
    $pyUrl = "https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe"
    $pyInstaller = "$env:TEMP\python-installer.exe"
    
    try {
        Invoke-WebRequest -Uri $pyUrl -OutFile $pyInstaller -UseBasicParsing
        Start-Process -FilePath $pyInstaller -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1" -Wait
        Remove-Item $pyInstaller -Force
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine")
        Write-OK "Python 3.12 已安装"
    } catch {
        Write-Error "Python 安装失败: $_"
    }
} else {
    $pyVer = & python --version 2>$null
    if (-not $pyVer) { $pyVer = & python3 --version 2>$null }
    Write-Info "Python 已安装 ($pyVer)"
}

# Refresh PATH
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

# Determine Python command
$PYTHON = if (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } else { "python" }

# ── Install Python deps ─────────────────────────────
Write-Info "安装 Python 依赖..."
& $PYTHON -m pip install --upgrade pip 2>&1 | Out-Null
# 逐个安装，忽略不兼容的包
$pyDeps = @("fastapi", "uvicorn", "requests", "python-multipart", "beautifulsoup4", "loguru", "lxml")
foreach ($dep in $pyDeps) {
    $result = & $PYTHON -m pip install $dep 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "  $dep 安装失败（Python 版本可能不兼容），已跳过"
    }
}
# aiofiles 在新 Python 上可能无 wheel，尝试安装
& $PYTHON -m pip install aiofiles 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Warn "aiofiles 安装失败，已跳过（不影响核心功能）" }
Write-OK "Python 依赖安装完成"

# ── Create required dirs ──────────────────────────
$dataDir = Join-Path $REPO_DIR "users"
$chatDir = Join-Path $REPO_DIR "chat_data"
$tmpDir = Join-Path $env:TEMP "pylib"
New-Item -ItemType Directory -Force -Path $dataDir, $chatDir, $tmpDir | Out-Null
Write-OK "目录已创建"

# ── Start backend engine ──────────────────────────
Write-Info "启动 Python 后端引擎..."
$engineLog = Join-Path $env:TEMP "engine_server.log"
$enginePidFile = Join-Path $env:TEMP "engine_server.pid"

$engineProc = Get-Process -Name "python*" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "engine_server" }
if ($engineProc) {
    Write-Info "引擎已在运行 (PID: $($engineProc.Id))"
} else {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = (Get-Command $PYTHON).Source
    $psi.Arguments = "$REPO_DIR\engine_server.py"
    $psi.WorkingDirectory = $REPO_DIR
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables["ENGINE_PORT"] = "8766"
    $p = [System.Diagnostics.Process]::Start($psi)
    $p.Id | Out-File -FilePath $enginePidFile -Force
    Write-OK "后端引擎已启动 (PID: $($p.Id))"
}

# ── Start PHP built-in server ─────────────────────
Write-Info "启动 PHP Web 服务器..."
$phpPort = 8080
$phpExe = if ($phpPath) { $phpPath } else { (Get-Command php -ErrorAction SilentlyContinue).Source }
if (-not $phpExe) { Write-Error "找不到 PHP，请手动安装 PHP 后重试" }
$phpProc = Get-Process -Name "php*" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "localhost:$phpPort" }
if ($phpProc) {
    Write-Info "PHP 服务器已在运行 (PID: $($phpProc.Id))"
} else {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $phpExe
    $psi.Arguments = "-S 0.0.0.0:$phpPort -t $REPO_DIR"
    $psi.WorkingDirectory = $REPO_DIR
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    Write-OK "PHP Web 服务器已启动 (端口: $phpPort)"
}

# ── Open browser ──────────────────────────────────
$localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^192\.|^10\.|^172\.' } | Select-Object -First 1).IPAddress
if (-not $localIP) { $localIP = "localhost" }

Write-OK ""
Write-OK "╔══════════════════════════════════════════╗"
Write-OK "║   OneAPIChat 部署完成！                  ║"
Write-OK "╚══════════════════════════════════════════╝"
Write-OK ""
Write-OK "  访问: http://$localIP`:$phpPort"
Write-Info "  引擎日志: Get-Content $engineLog -Tail 20"
Write-Info "  停止服务: Get-Process | Where-Object { `$_.CommandLine -match 'engine_server|php -S' } | Stop-Process"
Write-OK ""
Write-Info "  首次使用: 注册账号 → 在设置中填入 API Key"

Start-Process "http://localhost:$phpPort"

# ── Helper: Add to PATH ──────────────────────────────
function Add-MachinePathItem($item) {
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    if ($currentPath -notlike "*$item*") {
        [Environment]::SetEnvironmentVariable("Path", "$currentPath;$item", "Machine")
    }
}
