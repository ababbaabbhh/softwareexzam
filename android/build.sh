#!/usr/bin/env bash
# 仅在构建时导出环境变量，不写入全局配置
set -e
export JAVA_HOME=/app/workspace/toolchain/jdk
export ANDROID_HOME=/app/workspace/toolchain/sdk
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
GRADLE=/app/workspace/toolchain/gradle-8.7/bin/gradle
cd "$(dirname "$0")"
exec "$GRADLE" --no-daemon "$@"
