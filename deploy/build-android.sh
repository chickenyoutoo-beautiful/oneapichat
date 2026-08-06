#!/bin/bash
# OneAPIChat Android APK 构建脚本
# 依赖: JDK 21, Android SDK (ANDROID_HOME), Node.js, Capacitor
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
APK_NAME="OneAPIChat-${VERSION:-4.0.0}"

# ── 环境 ──
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# 代理（Gradle 下载依赖需要）
if [ "${USE_PROXY:-1}" = "1" ]; then
  export ALL_PROXY="${ALL_PROXY:-socks5h://127.0.0.1:1081}"
fi

cd "$SCRIPT_DIR"

echo "═══ OneAPIChat Android Build ═══"
echo "JAVA:    $JAVA_HOME ($(java -version 2>&1 | head -1))"
echo "SDK:     $ANDROID_HOME"
echo "Version: $APK_NAME"

# ── 同步 web assets ──
echo → 同步 web assets...
npx cap sync android

# ── 构建 ──
cd android
echo → 构建 APK...
if [ "${BUILD_TYPE:-debug}" = "release" ]; then
  ./gradlew assembleRelease --no-daemon
  APK_PATH="app/build/outputs/apk/release/app-release.apk"
else
  ./gradlew assembleDebug --no-daemon
  APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
fi

# ── 输出 ──
OUTPUT="$PROJECT_ROOT/${APK_NAME}-${BUILD_TYPE}.apk"
cp "$APK_PATH" "$OUTPUT"
echo "✅ 构建完成: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
