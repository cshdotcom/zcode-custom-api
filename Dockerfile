# syntax=docker/dockerfile:1
# ZCode 定制平台 — 全栈生产镜像（v3.15.1-standalone.6）
# 特性：单端口 :3000（平台登录门 + 联网搜索 MCP + 个人 API Token/OpenAI 兼容网关）
#      内置 CDP 浏览器桥（chromium，可用 ZCODE_EMBED_BROWSER=0 关闭省内存）
#      数据卷 /data（用户库 SQLite + 会话 + 服务 token，重启不丢）
FROM node:24-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ca-certificates curl openssl tini procps \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@10.33.2 --activate

FROM base AS build
WORKDIR /app
# node-gyp 兜底（node-pty/ssh2 等原生依赖的构建链）
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY . .
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1 \
    pnpm install --frozen-lockfile
# browser-remote 是 server 运行时 external 依赖，必须先出 dist；
# agent CLI 以 tsx 源码模式运行，其全部 workspace 依赖（@zcode/core 等）必须有 dist，
# 否则 CLI 子进程启动即崩（SQLite startup failed: transport_closed 连锁错误）
RUN pnpm --filter "@zcode/cli^..." build \
 && pnpm --filter "@zcode/browser-remote..." build \
 && pnpm --filter @zcode/server build
RUN NODE_OPTIONS=--max-old-space-size=3000 pnpm --filter @zcode/web build

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    ZCODE_PLATFORM_AUTH=1 \
    ZCODE_PLATFORM_SEARCH_MCP=1
WORKDIR /app
# 整仓复制：保证 workspace 符号链接与 external 依赖（ssh2/node-pty 等）完整可解析
COPY --from=build /app /app
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && rm -rf /app/data /app/logs
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -sf "http://127.0.0.1:${PORT}/healthz" || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
