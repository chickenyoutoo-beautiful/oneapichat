#!/bin/bash
set -e

# ==============================================================================
# OneAPIChat Docker 镜像与部署包导出脚本
# 生成完全自包含、可移植到任何无网络/全新服务器的安装包
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="${1:-oneapichat:latest}"
OUTPUT_DIR="${SCRIPT_DIR}/dist"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BUNDLE_NAME="oneapichat-bundle-${TIMESTAMP}"

mkdir -p "$OUTPUT_DIR/$BUNDLE_NAME"

echo "================================================================================"
echo "📦 正在导出 OneAPIChat 可移植离线部署包..."
echo "   镜像名称: $IMAGE_NAME"
echo "   目标输出: $OUTPUT_DIR/$BUNDLE_NAME"
echo "================================================================================"

# 1. 检查镜像是否存在，不存在则先触发构建
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    echo "⚠️ 镜像 $IMAGE_NAME 不存在，正在触发构建..."
    "$SCRIPT_DIR/build.sh" "$IMAGE_NAME"
fi

# 2. 导出镜像为压缩包
echo "⏳ 正在导出镜像层到 $BUNDLE_NAME/image.tar.gz (可能需要几分钟)..."
docker save "$IMAGE_NAME" | gzip > "$OUTPUT_DIR/$BUNDLE_NAME/image.tar.gz"

# 3. 复制部署配置文件与脚本
echo "📄 复制 Docker Compose 与配置模板..."
cp "$SCRIPT_DIR/docker-compose.yml" "$OUTPUT_DIR/$BUNDLE_NAME/"
cp "$SCRIPT_DIR/.env.example" "$OUTPUT_DIR/$BUNDLE_NAME/"
cp "$SCRIPT_DIR/.env.example" "$OUTPUT_DIR/$BUNDLE_NAME/.env"
cp "$SCRIPT_DIR/import.sh" "$OUTPUT_DIR/$BUNDLE_NAME/"
chmod +x "$OUTPUT_DIR/$BUNDLE_NAME/import.sh"

if [ -f "$SCRIPT_DIR/README_DOCKER.md" ]; then
    cp "$SCRIPT_DIR/README_DOCKER.md" "$OUTPUT_DIR/$BUNDLE_NAME/README.md"
fi

# 4. 打包为最终压缩归档
echo "📦 正在生成最终便携归档包: $OUTPUT_DIR/${BUNDLE_NAME}.tar.gz..."
cd "$OUTPUT_DIR"
tar -czf "${BUNDLE_NAME}.tar.gz" "$BUNDLE_NAME"

echo "================================================================================"
echo "🎉 导出成功！"
echo "   移植包路径: $OUTPUT_DIR/${BUNDLE_NAME}.tar.gz"
echo "   文件大小:   $(du -h "$OUTPUT_DIR/${BUNDLE_NAME}.tar.gz" | cut -f1)"
echo ""
echo "🚀 目标服务器部署步骤:"
echo "   1. 将 ${BUNDLE_NAME}.tar.gz 上传至任意目标服务器"
echo "   2. 解压: tar -xzf ${BUNDLE_NAME}.tar.gz && cd $BUNDLE_NAME"
echo "   3. 运行: ./import.sh"
echo "================================================================================"
