#!/bin/bash
set -e

# ==============================================================================
# OneAPIChat 新服务器一键导入与启动脚本
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "================================================================================"
echo "🚀 OneAPIChat 一键导入与部署"
echo "================================================================================"

# 1. 检查 Docker 与 Compose
if ! command -v docker >/dev/null 2>&1; then
    echo "❌ 错误: 未检测到 Docker，请先安装 Docker: https://docs.docker.com/engine/install/"
    exit 1
fi

# 2. 导入镜像
if [ -f "$SCRIPT_DIR/image.tar.gz" ]; then
    echo "⏳ 正在加载 Docker 镜像 (可能需要 1-2 分钟)..."
    docker load < "$SCRIPT_DIR/image.tar.gz"
    echo "✅ 镜像加载成功！"
fi

# 3. 初始化数据目录与权限
echo "📁 预置持久化数据目录结构..."
mkdir -p \
    ./data/users \
    ./data/chat_data \
    ./data/uploads \
    ./data/cloudreve \
    ./data/cloudreve_uploads \
    ./data/cpa_auths \
    ./data/automatic_cb \
    ./data/logs

# 预设权限 (容器内的 entrypoint 也会进行深度自愈)
chmod -R 777 ./data 2>/dev/null || true

# 4. 检查 .env
if [ ! -f "$SCRIPT_DIR/.env" ] && [ -f "$SCRIPT_DIR/.env.example" ]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo "ℹ️ 已根据模板创建 .env 配置文件，可按需编辑以绑定自定义域名。"
fi

# 5. 启动服务
echo "🐳 启动 OneAPIChat 容器..."
if docker compose version >/dev/null 2>&1; then
    docker compose up -d
elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose up -d
else
    echo "⚠️ 未检测到 docker compose 插件，使用 docker run 启动:"
    docker run -d \
        --name oneapichat \
        --restart unless-stopped \
        -p 8080:8080 \
        -p 5212:5212 \
        -p 8317:8317 \
        -v "$SCRIPT_DIR/data/users:/var/www/html/oneapichat/users" \
        -v "$SCRIPT_DIR/data/chat_data:/var/www/html/oneapichat/chat_data" \
        -v "$SCRIPT_DIR/data/uploads:/var/www/html/oneapichat/uploads" \
        -v "$SCRIPT_DIR/data/cloudreve:/var/www/cloudreve/data" \
        -v "$SCRIPT_DIR/data/cloudreve_uploads:/var/www/cloudreve/uploads" \
        -v "$SCRIPT_DIR/data/cpa_auths:/var/www/cpa/auths" \
        -v "$SCRIPT_DIR/data/automatic_cb:/tmp/AutomaticCB" \
        oneapichat:latest
fi

echo "================================================================================"
echo "🎉 OneAPIChat 已成功启动！"
echo "   - 主站 Web 界面:     http://<服务器IP或域名>:8080/"
echo "   - 超星刷课系统:       http://<服务器IP或域名>:8080/oneapichat/chaoxing.html"
echo "   - Cloudreve 云盘:    http://<服务器IP或域名>:8080/cloudreve/ (或 :5212)"
echo "   - CPA 代理管理面板:   http://<服务器IP或域名>:8080/cpa/ (或 :8317/management.html)"
echo "   - CPA OpenAI 端点:   http://<服务器IP或域名>:8080/v0/v1/chat/completions"
echo "================================================================================"
