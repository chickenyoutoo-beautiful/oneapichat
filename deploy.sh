#!/bin/bash
# ========== OneAPIChat One-Click Deploy Script ==========
# Supported: Ubuntu 20.04+ / Debian 11+ / CentOS 8+ / macOS
# Usage: chmod +x deploy.sh && ./deploy.sh

set -e

# ── Colors ──────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── Helpers ─────────────────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

need()    { command -v $1 >/dev/null 2>&1 || error "需要 $1，请先安装: apt install $1 / brew install $1"; }

# ── Detect OS ───────────────────────────────────────────
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    elif [ -f /etc/os-release ]; then
        . /etc/os-release
        case "$ID" in
            ubuntu|debian) OS="debian" ;;
            centos|rhel|rocky|alma) OS="centos" ;;
            *) OS="unknown" ;;
        esac
    else
        OS="unknown"
    fi
    info "检测到系统: $OS"
}

# ── Detect install method ───────────────────────────────
detect_method() {
    if command -v docker >/dev/null 2>&1; then
        METHOD="docker"
    elif command -v php >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
        METHOD="native"
    else
        METHOD="docker"
    fi
    info "安装方式: $METHOD"
}

# ── Docker install ──────────────────────────────────────
docker_install() {
    info "安装 Docker..."
    if [ "$OS" == "debian" ]; then
        apt-get update
        apt-get install -y ca-certificates curl gnupg lsb-release
        mkdir -p /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
        apt-get update
        apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    elif [ "$OS" == "centos" ]; then
        yum install -y yum-utils device-mapper-persistent-data lvm2
        yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
        yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    elif [ "$OS" == "macos" ]; then
        warn "macOS 请手动安装 Docker Desktop: https://docker.com/products/docker-desktop"
        return 0
    fi
    systemctl enable docker --now 2>/dev/null || true
    success "Docker 安装完成"
}

# ── Native install ──────────────────────────────────────
native_install() {
    info "安装系统依赖..."
    if [ "$OS" == "debian" ]; then
        apt-get update
        apt-get install -y php8.3 php8.3-fpm php8.3-curl php8.3-mbstring php8.3-xml php8.3-zip \
            nginx sqlite3 curl git
    elif [ "$OS" == "centos" ]; then
        yum install -y epel-release
        yum install -y php php-fpm php-mbstring php-xml php-zip nginx sqlite curl git
        systemctl enable php-fpm nginx
    elif [ "$OS" == "macos" ]; then
        brew install php nginx curl
    fi

    info "安装 Python 依赖..."
    if ! command -v pip3 >/dev/null 2>&1; then
        python3 -m ensurepip --default-pip 2>/dev/null || true
    fi
    pip3 install fastapi uvicorn requests pyaes beautifulsoup4 lxml loguru celery flask fonttools aiofiles python-multipart --break-system-packages

    success "原生安装完成"
}

# ── Native run ─────────────────────────────────────────
native_run() {
    info "启动服务..."

    # Create required directories
    mkdir -p /var/www/html/oneapichat/{users,chat_data}
    mkdir -p /tmp/AutomaticCB /tmp/pylib
    chmod -R 777 /var/www/html/oneapichat/users /var/www/html/oneapichat/chat_data /tmp/AutomaticCB /tmp/pylib 2>/dev/null || true

    # Configure nginx
    if [ "$OS" == "debian" ]; then
        cp nginx.conf /etc/nginx/sites-available/oneapichat 2>/dev/null || true
        ln -sf /etc/nginx/sites-available/oneapichat /etc/nginx/sites-enabled/oneapichat 2>/dev/null || true
        nginx -t && systemctl reload nginx
    fi

    # Start engine in background
    nohup python3 engine_server.py > /tmp/engine_server.log 2>&1 &
    ENGINE_PID=$!
    echo $ENGINE_PID > /tmp/engine_server.pid
    success "引擎已启动 (PID: $ENGINE_PID)"

    # Watchdog (optional)
    if command -v cron >/dev/null 2>&1; then
        (crontab -l 2>/dev/null | grep -v engine_watchdog; echo "*/5 * * * * sh $(pwd)/engine_watchdog.sh") | crontab -
        success "Watchdog 已配置"
    fi

    info "服务已启动！"
    info "  访问: http://$(hostname -I | awk '{print $1}'):8080"
    info "  引擎日志: tail -f /tmp/engine_server.log"
    info "  停止: kill \$(cat /tmp/engine_server.pid)"
}

# ── Docker run ──────────────────────────────────────────
docker_run() {
    info "使用 Docker 部署..."
    docker compose up -d --build
    success "容器已启动！"
    info "  访问: http://\$(docker exec oneapichat hostname -I | awk '{print \$1}'):8080"
    info "  查看日志: docker compose logs -f"
    info "  停止: docker compose down"
}

# ── Main ────────────────────────────────────────────────
main() {
    echo ""
    echo "╔═══════════════════════════════════════════════╗"
    echo "║      OneAPIChat 一键部署脚本 v1.0             ║"
    echo "╚═══════════════════════════════════════════════╝"
    echo ""

    detect_os
    detect_method

    case "$METHOD" in
        docker)
            docker_install
            docker_run
            ;;
        native)
            native_install
            native_run
            ;;
    esac

    echo ""
    success "部署完成！有问题请提交 Issue: https://github.com/chickenyoutoo-beautiful/Webui-aichat-supportwebsearch"
    echo ""
}

main "$@"