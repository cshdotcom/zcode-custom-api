#!/usr/bin/env bash
# ZCode 定制平台容器入口：数据持久化 + 可选内置浏览器桥 + 生产单端口启动
set -e

DATA_DIR="${ZCODE_DATA_DIR:-/data}"
mkdir -p "$DATA_DIR/browser-profile"
export HOME="$DATA_DIR"   # getAppConfigDir() → $DATA_DIR/.zcode/v2（平台用户库/设置落盘此处）

# 服务 token：优先用环境变量注入，否则持久化到数据卷（重启不变）
if [ -z "${ZCODE_PLATFORM_SERVICE_TOKEN:-}" ]; then
  TOKEN_FILE="$DATA_DIR/platform-env.txt"
  if [ -f "$TOKEN_FILE" ]; then
    export ZCODE_PLATFORM_SERVICE_TOKEN="$(grep -oP 'TOKEN=\K.*' "$TOKEN_FILE" | head -1)"
  else
    export ZCODE_PLATFORM_SERVICE_TOKEN="$(openssl rand -hex 24)"
    echo "TOKEN=$ZCODE_PLATFORM_SERVICE_TOKEN" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
  fi
fi

# 内置浏览器桥（CDP headless chromium）；资源紧张时可 ZCODE_EMBED_BROWSER=0 关闭
if [ "${ZCODE_EMBED_BROWSER:-1}" = "1" ] && ! curl -s --max-time 1 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  /usr/bin/chromium --headless --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 \
    --user-data-dir="$DATA_DIR/browser-profile" --window-size=1440,900 about:blank &
  export ZCODE_BROWSER_REMOTE_ENDPOINT="${ZCODE_BROWSER_REMOTE_ENDPOINT:-http://127.0.0.1:9222}"
  export ZCODE_BROWSER_REMOTE_MODE=cdp
fi

export PORT="${PORT:-3000}"
export ZCODE_PLATFORM_AUTH="${ZCODE_PLATFORM_AUTH:-1}"
export ZCODE_PLATFORM_SEARCH_MCP="${ZCODE_PLATFORM_SEARCH_MCP:-1}"
# 每用户数据隔离（多租户安全基线）：会话/任务/provider 配置按用户分目录落盘。
# ZCODE_PLATFORM_USERS_ROOT=0 可显式关闭（单管理员自用场景）。
if [ "${ZCODE_PLATFORM_USERS_ROOT:-1}" != "0" ]; then
  export ZCODE_PLATFORM_USERS_ROOT="${ZCODE_PLATFORM_USERS_ROOT:-$DATA_DIR/users}"
  mkdir -p "$ZCODE_PLATFORM_USERS_ROOT"
fi
export ZCODE_WEB_STATIC_ROOT=/app/packages/web/dist

exec node /app/packages/server/dist/entry-http.js
