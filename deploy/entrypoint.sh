#!/bin/bash
set -e

# ==============================================================================
# OneAPIChat Container Entrypoint
# 负责权限自愈、配置模板初始化、域名适配与多服务引导
# ==============================================================================

echo "================================================================================"
echo "🚀 正在启动 OneAPIChat 全栈容器 (Web + Engine + Cloudreve + CPA + Chaoxing)..."
echo "================================================================================"

# 全局默认文件创建掩码 (同组完全读写)
umask 0002

APP_DIR="/var/www/html/oneapichat"
CLOUDREVE_DIR="/var/www/cloudreve"
CPA_DIR="/var/www/cpa"

# ------------------------------------------------------------------------------
# 1. 确保所有持久化及工作目录存在
# ------------------------------------------------------------------------------
echo "📁 检查并创建运行时与数据持久化目录..."
mkdir -p \
    "$APP_DIR/users/chaoxing" \
    "$APP_DIR/chat_data" \
    "$APP_DIR/uploads" \
    "$APP_DIR/.engine" \
    "$APP_DIR/config" \
    "$APP_DIR/python/chaoxing" \
    "/tmp/AutomaticCB" \
    "/tmp/pylib" \
    "$CLOUDREVE_DIR/data" \
    "$CLOUDREVE_DIR/uploads" \
    "$CLOUDREVE_DIR/avatar" \
    "$CPA_DIR/auths" \
    "$CPA_DIR/logs" \
    "/var/log/supervisor" \
    "/var/log/nginx" \
    "/var/log/php" \
    "/run/php"

# ------------------------------------------------------------------------------
# 2. 初始配置自愈与安全密钥生成
# ------------------------------------------------------------------------------
# (a) OneAPIChat 主配置
if [ ! -f "$APP_DIR/config.ini" ]; then
    echo "⚙️ 未检测到 config.ini，从模板生成初始配置..."
    if [ -f "$APP_DIR/config.ini.template" ]; then
        cp "$APP_DIR/config.ini.template" "$APP_DIR/config.ini"
    else
        cat <<EOF > "$APP_DIR/config.ini"
[common]
encryption_key = $(openssl rand -hex 16)
username =
password =
course_list =
speed = 2
auto_next = true
brush_mode = all
chapter_order = sequential

[tiku]
provider=TikuYanxi,TikuAI
submit=true
tokens=
true_list=正确,对,√,是
false_list=错误,错,×,否,不对,不正确
ai_base_url=https://api.deepseek.com
ai_model=deepseek-v4-flash
ai_key=

[netdisk]
jxpan_api =
EOF
    fi

    # 如果环境变量指定了 ENCRYPTION_KEY，优先注入
    if [ -n "$ENCRYPTION_KEY" ]; then
        sed -i "s/^encryption_key = .*/encryption_key = $ENCRYPTION_KEY/" "$APP_DIR/config.ini"
    elif grep -q "your-random-32-char-string-here" "$APP_DIR/config.ini"; then
        NEW_KEY=$(openssl rand -hex 16)
        sed -i "s/your-random-32-char-string-here/$NEW_KEY/" "$APP_DIR/config.ini"
    fi
fi

# (b) 用户数据初始化
if [ ! -f "$APP_DIR/users/users.json" ]; then
    echo "[]" > "$APP_DIR/users/users.json"
fi

# (c) Cloudreve 配置初始化
if [ ! -f "$CLOUDREVE_DIR/data/conf.ini" ]; then
    echo "☁️ 初始化 Cloudreve 默认配置..."
    if [ -f "/etc/cloudreve/cloudreve-conf.ini" ]; then
        cp "/etc/cloudreve/cloudreve-conf.ini" "$CLOUDREVE_DIR/data/conf.ini"
    else
        cat <<EOF > "$CLOUDREVE_DIR/data/conf.ini"
[System]
Debug = false
Mode = master
Listen = :5212
SessionSecret = $(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 48)
HashIDSalt = $(openssl rand -hex 32)
SiteURL = ${CLOUDREVE_SITE_URL:-http://localhost:8080/cloudreve}

[Database]
Type = sqlite
DBFile = $CLOUDREVE_DIR/data/cloudreve.db
EOF
    fi
fi

# 动态适配 Cloudreve 站点 URL (兼容域名绑定)
if [ -n "$CLOUDREVE_SITE_URL" ]; then
    echo "🌐 设置 Cloudreve 站点 URL 为: $CLOUDREVE_SITE_URL"
    sed -i "s|^SiteURL = .*|SiteURL = $CLOUDREVE_SITE_URL|" "$CLOUDREVE_DIR/data/conf.ini"
elif [ -n "$DOMAIN" ]; then
    CR_URL="http://$DOMAIN/cloudreve"
    [ "$SSL_ENABLED" = "true" ] && CR_URL="https://$DOMAIN/cloudreve"
    sed -i "s|^SiteURL = .*|SiteURL = $CR_URL|" "$CLOUDREVE_DIR/data/conf.ini"
fi

# (d) CPA (CLIProxyAPI) 配置初始化
if [ ! -f "$CPA_DIR/config.yaml" ]; then
    echo "🔄 初始化 CPA 默认配置..."
    if [ -f "/etc/cpa/cpa-config.yaml" ]; then
        cp "/etc/cpa/cpa-config.yaml" "$CPA_DIR/config.yaml"
    fi
fi

# 环境变量动态设置 CPA API Key
if [ -n "$CPA_API_KEY" ] && [ -f "$CPA_DIR/config.yaml" ]; then
    sed -i "s|cpa-oneapichat-default-key|$CPA_API_KEY|" "$CPA_DIR/config.yaml"
fi

# ------------------------------------------------------------------------------
# 3. 域名绑定与 Nginx 配置动态渲染
# ------------------------------------------------------------------------------
if [ -n "$DOMAIN" ] || [ -n "$SERVER_NAME" ]; then
    CUSTOM_DOMAIN="${DOMAIN:-$SERVER_NAME}"
    echo "🌐 绑定自定义域名: $CUSTOM_DOMAIN (并保留通配兜底支持 IP 直连)"
    sed -i "s|server_name _;|server_name $CUSTOM_DOMAIN _;|" /etc/nginx/sites-enabled/default 2>/dev/null || true
fi

# ------------------------------------------------------------------------------
# 4. 各级权限深度自愈与加固 (根除任何跨用户死锁)
# ------------------------------------------------------------------------------
echo "🔒 正在执行各级权限自愈 (统一 www-data 属主与组写权限)..."
chown -R www-data:www-data \
    "$APP_DIR" \
    "$CLOUDREVE_DIR" \
    "$CPA_DIR" \
    "/tmp/AutomaticCB" \
    "/tmp/pylib" \
    "/var/log/php" \
    "/run/php" \
    2>/dev/null || true

# 目录赋予 SGID，确保内部新建文件自动继承 www-data 属组
find "$APP_DIR/users" -type d -exec chmod 2775 {} + 2>/dev/null || true
find "$APP_DIR/chat_data" -type d -exec chmod 2775 {} + 2>/dev/null || true
find "$APP_DIR/uploads" -type d -exec chmod 2775 {} + 2>/dev/null || true
find "$APP_DIR/.engine" -type d -exec chmod 2775 {} + 2>/dev/null || true
find "$CLOUDREVE_DIR/data" -type d -exec chmod 2775 {} + 2>/dev/null || true
find "$CPA_DIR" -type d -exec chmod 2775 {} + 2>/dev/null || true
find "/tmp/AutomaticCB" -type d -exec chmod 2775 {} + 2>/dev/null || true

# 文件权限确保 664 / 660 可读写
find "$APP_DIR/users" -type f -exec chmod 664 {} + 2>/dev/null || true
find "$APP_DIR/chat_data" -type f -exec chmod 664 {} + 2>/dev/null || true
find "$APP_DIR/uploads" -type f -exec chmod 664 {} + 2>/dev/null || true
find "$CLOUDREVE_DIR/data" -type f -exec chmod 664 {} + 2>/dev/null || true
chmod 775 "$APP_DIR/python/chaoxing" 2>/dev/null || true
chmod 664 "$APP_DIR/python/chaoxing/learning_records.db"* 2>/dev/null || true

# ------------------------------------------------------------------------------
# 5. 可选子服务开关判定
# ------------------------------------------------------------------------------
if [ "$ENABLE_CLOUDREVE" = "false" ]; then
    echo "⚠️ 检测到 ENABLE_CLOUDREVE=false，禁用 Cloudreve 云盘服务"
    sed -i '/\[program:cloudreve\]/,+6d' /etc/supervisor/conf.d/oneapichat.conf 2>/dev/null || true
fi

if [ "$ENABLE_CPA" = "false" ]; then
    echo "⚠️ 检测到 ENABLE_CPA=false，禁用 CLIProxyAPI 服务"
    sed -i '/\[program:cli-proxy-api\]/,+6d' /etc/supervisor/conf.d/oneapichat.conf 2>/dev/null || true
fi

echo "================================================================================"
echo "✅ 容器初始化与权限配置完毕，启动 Supervisor 守护进程..."
echo "================================================================================"

exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf -n
