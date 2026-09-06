#!/bin/bash
set -e

# ==============================================================================
# OneAPIChat Docker 镜像一键构建脚本
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
IMAGE_TAG="${1:-oneapichat:latest}"

echo "================================================================================"
echo "🔨 开始构建 OneAPIChat 一体化全栈 Docker 镜像: $IMAGE_TAG"
echo "   源码目录: $ROOT_DIR"
echo "   构建文件: $SCRIPT_DIR/Dockerfile"
echo "================================================================================"

cd "$ROOT_DIR"

# 检查 docker 命令
if ! command -v docker >/dev/null 2>&1; then
    echo "❌ 错误: 未安装 Docker，请先安装 Docker 环境。"
    exit 1
fi

docker build \
    -t "$IMAGE_TAG" \
    -f "$SCRIPT_DIR/Dockerfile" \
    "$ROOT_DIR"

echo "================================================================================"
echo "✅ 构建完成！镜像名称: $IMAGE_TAG"
echo "   运行方式 1 (Docker Compose):"
echo "       cd $SCRIPT_DIR && docker compose up -d"
echo "   运行方式 2 (Docker Run):"
echo "       docker run -d --name oneapichat -p 8080:8080 -v \$(pwd)/data:/var/www/html/oneapichat/users $IMAGE_TAG"
echo "   导出移植包:"
echo "       $SCRIPT_DIR/export.sh"
echo "================================================================================"
