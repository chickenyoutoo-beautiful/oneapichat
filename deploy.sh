#!/bin/bash
# ========== OneAPIChat One-Click Deploy Script ==========
# Supports: Ubuntu 20.04+ / Debian 11+ / CentOS 8+ / macOS
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/.../deploy.sh | bash
#   chmod +x deploy.sh && ./deploy.sh
set -e

# ── Colors ──────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Repository info ─────────────────────────────────────
REPO_URL="https://github.com/chickenyoutoo-beautiful/Webui-aichat-supportwebsearch.git"
INSTALL_DIR="/var/www/html/oneapichat"

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
    info "OS: $OS ($(uname -m))"
}

# ── Get repo files ──────────────────────────────────────
get_repo() {
    # Check if we're already inside the repo
    if [ -f "./index.html" ] && [ -f "./engine_server.py" ]; then
        REPO_DIR=$(pwd)
        info "已在仓库目录: $REPO_DIR"
    else
        need git
        if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/index.html" ]; then
            REPO_DIR="$INSTALL_DIR"
            info "仓库已存在: $REPO_DIR"
        else
            REPO_DIR="$INSTALL_DIR"
            info "克隆仓库..."
            mkdir -p "$(dirname "$INSTALL_DIR")"
            git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
            success "仓库已克隆到: $REPO_DIR"
        fi
    fi
    cd "$REPO_DIR"
}

# ── Detect/mount PHP version ────────────────────────────
detect_php() {
    if command -v php8.3 >/dev/null 2>&1; then
        PHP_FPM="php8.3-fpm"
        PHP_PACKAGES="php8.3 php8.3-fpm php8.3-curl php8.3-mbstring php8.3-xml php8.3-zip"
    elif command -v php8.2 >/dev/null 2>&1; then
        PHP_FPM="php8.2-fpm"
        PHP_PACKAGES="php8.2 php8.2-fpm php8.2-curl php8.2-mbstring php8.2-xml php8.2-zip"
    elif command -v php8.1 >/dev/null 2>&1; then
        PHP_FPM="php8.1-fpm"
        PHP_PACKAGES="php8.1 php8.1-fpm php8.1-curl php8.1-mbstring php8.1-xml php8.1-zip"
    elif command -v php >/dev/null 2>&1; then
        PHP_VER=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')
        PHP_FPM="php${PHP_VER}-fpm"
        PHP_PACKAGES="php${PHP_VER} php${PHP_VER}-fpm php${PHP_VER}-curl php${PHP_VER}-mbstring php${PHP_VER}-xml php${PHP_VER}-zip"
    else
        # Default to 8.3 on modern Debian/Ubuntu, 8.1 on older
        if grep -qi "ubuntu\|debian" /etc/os-release 2>/dev/null; then
            if grep -qi "focal\|bullseye" /etc/os-release 2>/dev/null; then
                PHP_FPM="php8.1-fpm"
                PHP_PACKAGES="php8.1 php8.1-fpm php8.1-curl php8.1-mbstring php8.1-xml php8.1-zip"
            else
                PHP_FPM="php8.3-fpm"
                PHP_PACKAGES="php8.3 php8.3-fpm php8.3-curl php8.3-mbstring php8.3-xml php8.3-zip"
            fi
        else
            PHP_FPM="php-fpm"
            PHP_PACKAGES="php php-fpm php-mbstring php-xml php-zip php-curl"
        fi
    fi

    # Check if SURY repo needed (Debian/Ubuntu with php8.3 not in default repos)
    if [[ "$OS" == "debian" ]] && ! command -v php >/dev/null 2>&1; then
        if [[ "$PHP_FPM" == "php8.3-fpm" ]] || [[ "$PHP_FPM" == "php8.2-fpm" ]]; then
            # Check if this version is available in default repos
            if ! apt-cache show "php8.3" >/dev/null 2>&1 && ! apt-cache show "php8.2" >/dev/null 2>&1; then
                info "添加 SURY PHP 仓库..."
                apt-get update -qq
                apt-get install -y -qq ca-certificates curl gnupg 2>/dev/null
                curl -sSL https://packages.sury.org/php/apt.gpg 2>/dev/null | gpg --dearmor -o /usr/share/keyrings/php-sury.gpg 2>/dev/null || true
                echo "deb [signed-by=/usr/share/keyrings/php-sury.gpg] https://packages.sury.org/php/ $(lsb_release -cs) main" > /etc/apt/sources.list.d/php-sury.list 2>/dev/null || true
            fi
        fi
    fi

    info "PHP: ${PHP_FPM:-php-fpm}"
    info "PHP packages: ${PHP_PACKAGES}"
}

# ── Detect install method ───────────────────────────────
detect_method() {
    if command -v docker >/dev/null 2>&1; then
        METHOD="docker"
    elif command -v pip3 >/dev/null 2>&1 && command -v nginx >/dev/null 2>&1; then
        # All native deps already installed
        METHOD="native"
    else
        # Need to install something — prefer native on Linux, docker on macOS
        case "$OS" in
            macos)
                if command -v docker >/dev/null 2>&1; then
                    METHOD="docker"
                else
                    METHOD="native"
                fi
                ;;
            *) METHOD="native" ;;
        esac
    fi
    info "安装方式: $METHOD"
}

# ── Get PHP-FPM socket path ─────────────────────────────
get_fpm_socket() {
    local ver="${PHP_FPM#php}"
    ver="${ver%-fpm}"
    # Try common socket paths
    for sock in "/run/php/php${ver}-fpm.sock" "/var/run/php/php${ver}-fpm.sock" "/run/php-fpm.sock"; do
        if [ -S "$sock" ]; then
            echo "$sock"
            return 0
        fi
    done
    # Guess based on PHP version
    echo "/run/php/php${ver}-fpm.sock"
}

# ── Docker install ──────────────────────────────────────
docker_install() {
    if ! command -v docker >/dev/null 2>&1; then
        info "安装 Docker..."
        case "$OS" in
            debian)
                apt-get update -qq
                apt-get install -y -qq ca-certificates curl gnupg lsb-release
                mkdir -p /etc/apt/keyrings
                curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
                echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
                apt-get update -qq
                apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
                systemctl enable docker --now 2>/dev/null || true
                ;;
            centos)
                yum install -y -q yum-utils device-mapper-persistent-data lvm2
                yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
                yum install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
                systemctl enable docker --now 2>/dev/null || true
                ;;
            macos)
                warn "请手动安装 Docker Desktop: https://docker.com/products/docker-desktop"
                return 0
                ;;
        esac
        success "Docker 安装完成"
    else
        info "Docker 已安装"
    fi
}

docker_run() {
    info "使用 Docker 部署..."
    cd "$REPO_DIR"
    docker compose up -d --build 2>&1 | tail -5
    success "容器已启动！"
    info "  访问: http://localhost:8080"
    info "  查看日志: docker compose logs -f"
    info "  停止: docker compose down"
}

# ── Native install ──────────────────────────────────────
native_install() {
    case "$OS" in
        debian)
            info "安装系统依赖 (Debian/Ubuntu)..."
            apt-get update -qq
            DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
                $PHP_PACKAGES nginx sqlite3 curl git python3 python3-pip python3-venv 2>&1 | tail -3
            ;;
        centos)
            info "安装系统依赖 (CentOS/RHEL)..."
            yum install -y -q epel-release
            yum install -y -q $PHP_PACKAGES nginx sqlite curl git python3 python3-pip
            systemctl enable php-fpm nginx 2>/dev/null || true
            ;;
        macos)
            info "安装系统依赖 (macOS)..."
            brew install php nginx curl git python@3.11 2>&1 | tail -3
            ;;
    esac

    info "安装 Python 依赖..."
    pip3 install fastapi uvicorn requests aiofiles python-multipart \
        --break-system-packages 2>/dev/null || \
    pip3 install fastapi uvicorn requests aiofiles python-multipart 2>&1 | tail -3

    success "依赖安装完成"
}

native_run() {
    info "配置并启动服务..."

    # Copy files to install directory if not already there
    if [ "$REPO_DIR" != "$INSTALL_DIR" ]; then
        info "复制文件到 $INSTALL_DIR ..."
        mkdir -p "$INSTALL_DIR"
        cp -a "$REPO_DIR"/* "$INSTALL_DIR/" 2>/dev/null || cp -r "$REPO_DIR"/* "$INSTALL_DIR/"
        cp -a "$REPO_DIR"/.[!.]* "$INSTALL_DIR/" 2>/dev/null || true
    fi
    cd "$INSTALL_DIR"

    # Create required directories
    mkdir -p users chat_data /tmp/AutomaticCB /tmp/pylib
    chmod -R 777 users chat_data /tmp/AutomaticCB /tmp/pylib 2>/dev/null || true

    # Configure nginx
    FPM_SOCK=$(get_fpm_socket)
    info "PHP-FPM socket: $FPM_SOCK"

    if [[ "$OS" == "debian" ]]; then
        # Generate nginx site config from template
        cat > /etc/nginx/sites-available/oneapichat << 'NGINXEOF'
server {
    listen 8080 default_server;
    server_name _;
    root /var/www/html;
    index index.html index.php;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location ~ \.php$ {
        try_files $uri =404;
        fastcgi_split_path_info ^(.+\.php)(/.+)$;
NGINXEOF
        echo "        fastcgi_pass unix:${FPM_SOCK};" >> /etc/nginx/sites-available/oneapichat
        cat >> /etc/nginx/sites-available/oneapichat << 'NGINXEOF'
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_param PATH_INFO $fastcgi_path_info;
    }

    location /engine/ {
        proxy_pass http://127.0.0.1:8766/engine/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400;
        chunked_transfer_encoding on;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location ~ /\. { deny all; }
    location ~* (config\.ini|learning_records\.db|\.env|\.git) { deny all; }

    location / {
        try_files $uri $uri/ =404;
    }
}
NGINXEOF
        ln -sf /etc/nginx/sites-available/oneapichat /etc/nginx/sites-enabled/
        rm -f /etc/nginx/sites-enabled/default
    elif [[ "$OS" == "centos" ]]; then
        # CentOS uses conf.d
        cat > /etc/nginx/conf.d/oneapichat.conf << 'NGINXEOF'
server {
    listen 8080;
    server_name _;
    root /var/www/html;
    index index.html index.php;
    # ... (same config as above)
}
NGINXEOF
        sed -i "s|unix:.*;|unix:${FPM_SOCK};|" /etc/nginx/conf.d/oneapichat.conf 2>/dev/null || true
    fi

    # Test and reload nginx
    nginx -t && systemctl reload nginx 2>/dev/null || nginx -t && nginx -s reload 2>/dev/null || true
    success "Nginx 配置完成"

    # Start Python engine
    if pgrep -f "engine_server.py" >/dev/null 2>&1; then
        info "引擎已在运行，跳过启动"
    else
        nohup python3 engine_server.py > /tmp/engine_server.log 2>&1 &
        ENGINE_PID=$!
        echo $ENGINE_PID > /tmp/engine_server.pid
        success "引擎已启动 (PID: $ENGINE_PID)"
    fi

    # Watchdog cron
    if command -v crontab >/dev/null 2>&1; then
        (crontab -l 2>/dev/null | grep -v "engine_watchdog"; echo "*/5 * * * * cd ${INSTALL_DIR} && bash engine_watchdog.sh") | crontab - 2>/dev/null || true
        success "Watchdog 已配置"
    fi

    # Get IP
    local IP
    IP=$(ip route get 1 2>/dev/null | awk '{print $NF; exit}' || hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

    success "部署完成！"
    echo ""
    info "  访问: http://${IP}:8080"
    info "  引擎日志: tail -f /tmp/engine_server.log"
    info "  停止引擎: kill \$(cat /tmp/engine_server.pid)"
}

# ── Main ────────────────────────────────────────────────
main() {
    echo ""
    echo "╔═══════════════════════════════════════════════╗"
    echo "║      OneAPIChat 一键部署脚本 v2.0             ║"
    echo "╚═══════════════════════════════════════════════╝"
    echo ""

    detect_os

    # Must run as root for native install on Linux
    if [[ "$OS" != "macos" ]] && [[ "$EUID" -ne 0 ]]; then
        error "请使用 root 权限运行 (sudo bash deploy.sh)"
    fi

    get_repo
    detect_php
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
    success "OneAPIChat 已部署！问题反馈: https://github.com/chickenyoutoo-beautiful/Webui-aichat-supportwebsearch/issues"
    echo ""
}

main "$@"
