# syntax=docker/dockerfile:1
# =============================================================================
# ZCode Standalone 一键部署镜像
# 架构：浏览器 ZCode Web 前端 ↔ ZCode Server(本镜像) ↔ 远程 Playwright 浏览器容器
# 配合 deploy/docker-compose.yml 使用（playwright 容器由 compose 提供）。
# =============================================================================

FROM node:24-bookworm-slim AS builder

RUN npm install -g pnpm@10.33.2
WORKDIR /app

# 先拷贝依赖清单利用层缓存
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY scripts ./scripts
COPY packages/shared/package.json packages/shared/
COPY packages/rpc/package.json packages/rpc/
COPY packages/services/package.json packages/services/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
COPY packages/browser-remote/package.json packages/browser-remote/
COPY packages/web/package.json packages/web/
COPY packages/ui/package.json packages/ui/
COPY packages/provider/package.json packages/provider/
COPY packages/model-option-map/package.json packages/model-option-map/
COPY packages/zcode-cua/package.json packages/zcode-cua/
COPY packages/share-ui/package.json packages/share-ui/
COPY packages/web-share/package.json packages/web-share/
COPY packages/stream-animate/package.json packages/stream-animate/
COPY packages/formal-proof/package.json packages/formal-proof/
COPY packages/android/package.json packages/android/
COPY packages/e2e-report/package.json packages/e2e-report/
COPY apps/zcode-cli/package.json apps/zcode-cli/
COPY apps/zcode-cli/packages/contracts/package.json apps/zcode-cli/packages/contracts/
COPY apps/zcode-cli/packages/core/package.json apps/zcode-cli/packages/core/
COPY apps/zcode-cli/packages/adapters/package.json apps/zcode-cli/packages/adapters/
COPY apps/zcode-cli/packages/bootstrap/package.json apps/zcode-cli/packages/bootstrap/
COPY apps/zcode-cli/packages/cli/package.json apps/zcode-cli/packages/cli/
COPY apps/zcode-cli/packages/browser-use-plugin/package.json apps/zcode-cli/packages/browser-use-plugin/
COPY apps/zcode-cli/packages/node-repl-host/package.json apps/zcode-cli/packages/node-repl-host/
COPY apps/zcode-cli/packages/dynamic-workflow/package.json apps/zcode-cli/packages/dynamic-workflow/
COPY apps/zcode-cli/tools/package.json apps/zcode-cli/tools/

RUN pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile

# 拷贝全部源码并构建（web 产物禁 sourcemap 控制内存）
COPY . .
RUN NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter @zcode/cli... build \
 && NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter @zcode/browser-remote build \
 && NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter @zcode/web exec vite build --sourcemap false \
 && NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter @zcode/server build \
 && mkdir -p packages/server/dist/assets \
 && cp packages/server/assets/platform-search-mcp-server.mjs packages/server/dist/assets/

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
COPY --from=builder /app ./

ENV NODE_ENV=production \
    PORT=3000 \
    ZCODE_WEB_STATIC_ROOT=/app/packages/web/dist \
    ZCODE_PLATFORM_AUTH=1 \
    ZCODE_PLATFORM_SEARCH_MCP=1

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||3000) +'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/entry-http.js"]
