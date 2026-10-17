# ZCode Standalone：远程浏览器 CUA + 联网搜索插件 + 自有用户/登录系统

> 完整可落地方案。基于开源项目 zai-org/ZCode v3.15.1（`standalone` 分支）。
> 架构原则：**不改动 ZCode Web 前端界面**，保留全部原有 UI、任务、文件、终端、MCP 功能；
> 所有增强能力都在 **ZCode Server 层**以适配器方式注入。

---

## 1. 总体架构

```
┌──────────────────┐        ┌─────────────────────────────┐        ┌──────────────────────┐
│  浏览器            │        │  ZCode Server               │        │  远程浏览器容器         │
│  ZCode Web 前端    │◄─WS──► │  (packages/server)          │◄─CDP──►│  Playwright Chromium  │
│  （原 SPA 不改动）  │  HTTP  │  ├─ 静态托管 SPA             │  或     │  (独立容器 / 任意主机)  │
│  任务/文件/终端/MCP │        │  ├─ 平台层：用户系统+登录     │ Playwright│ - AI 访问网页        │
└──────────────────┘        │  ├─ 联网搜索插件 + OpenWebUI  │  协议    │  - 点击/输入/滚动      │
        ▲ ZCode Agent        │  │   兼容端点                 │        │  - 截图/DOM 坐标拾取   │
        │  stdio(协议)       │  └─ browserControlExecutor   │        └──────────────────────┘
        └──────────────────►│      (远程浏览器执行桥)        │
   ZCode Agent(app-server)  └─────────────────────────────┘
```

### 三大能力与数据流

**A. 浏览器自动化（替换 web 版 zcode-cua 占位 stub）**

ZCode 桌面版的浏览器操控由 Electron 主进程（`packages/desktop` 的 WebContentsView+CDP）实现；
web 版的 `zcode-cua` 模块是占位 stub，agent 的 `interaction/browserExecute` 反向请求在服务端
拿不到执行器时返回 `{ browsers: [] }`（browser 能力不可见）。

本方案在 **ZCode Server 内实现 `BrowserAmbientContextExecutor`**（services 已预留的执行桥接口），
把 agent 的每条浏览器指令翻译成 Playwright 命令，转发到独立 Playwright 浏览器容器执行，
结果（页面状态/DOM snapshot/元素坐标/截图 base64）原路返回 agent，并最终呈现在原有 Web UI 的
browser 面板中。前端零改动。

agent 侧指令流（上游代码，无需修改）：
`agent.browsers.*`（browser-use 插件）→ `ProtocolBrowserControlBroker` →
ZCode Protocol `interaction/browserList` / `interaction/browserExecute` 反向请求 →
`zcodeAgentService.onRequest` → `browserControlExecutor`（**本次新增实现**）→ 远程浏览器。

**B. 联网搜索插件**

- Agent 工具：自研零依赖 MCP stdio server（`web_search` / `fetch_page`）注册进
  `~/.zcode/cli/config.json` → agent 自动获得联网搜索能力；
- 多 Provider：DuckDuckGo（免key）/ Tavily / Brave / Google PSE / Bing / Serper /
  SearXNG / Jina / Exa / 博查 / 智谱 / OpenWebUI 兼容自定义端点，管理页热切换；
- 对外兼容：`/search` 同时兼容 OpenWebUI 两种接入方式（见 §5）。

**C. 自有用户管理系统 + 登录系统（替代官方登录）**

- `ZCODE_PLATFORM_AUTH=1` 时，server 层统一会话鉴权（Hono 中间件，HTTP+WS 全覆盖），
  未登录访问一律 302 → `/login`（server 自渲染登录页，**原 SPA 完全不动**）；
- 用户库 node:sqlite（Node 24 内置，零 native 依赖），scrypt 口令散列，会话可吊销；
- 首个注册账号自动成为管理员；管理员在 `/platform/admin` 管理用户（创建/禁用/重置密码/删除）；
- 模型 API Key 由管理员在原有「设置 → 模型供应商」中配置一次，全平台共享——
  最终用户全程不接触官方 z.ai 登录，也不接触 API Key。

---

## 2. 修改/新增的源码文件清单

### 2.1 修改（3 个）

| 文件 | 改动 |
| --- | --- |
| `apps/zcode-cli/packages/adapters/src/browser/index.ts` | `ManagedCdpBrowserRuntimeOptions` 新增 `remote?: { endpoint; mode: "cdp"\|"playwright"; connectTimeoutMs? }`；`ensureBrowser()` 远程分支走 `chromium.connectOverCDP()` / `chromium.connect()`；`createManagedCdpBrowserRuntime()` 远程模式跳过本地可执行文件校验 |
| `apps/zcode-cli/packages/adapters/src/browser/descriptor.ts` | `createManagedCdpDescriptor()` 支持 overrides（远程 backend 名称/元数据：`launchMode: "remote"`） |
| `packages/server/src/entry-http.ts` | 读取 `ZCODE_BROWSER_REMOTE_ENDPOINT/MODE`、`ZCODE_PLATFORM_AUTH`、`ZCODE_PLATFORM_SERVICE_TOKEN`、`ZCODE_PLATFORM_SEARCH_MCP`；创建 `PlatformStore`/`SearchService`/`RemoteBrowserExecutor` 并装配进 `createLocalServices`（`browserControlExecutor`）与 `createHttpServer`（`platform`） |

### 2.2 新增

| 文件 | 作用 |
| --- | --- |
| `packages/browser-remote/`（新包 `@zcode/browser-remote`） | **核心适配器**：`createRemoteBrowserExecutor()` 把 services 的 `BrowserAmbientContextExecutor` 接口桥接到 `@zcode/adapters` 的 `BrowserControlPort`（远程 Playwright/CDP）；懒连接、按会话隔离 BrowserContext、backend 掉线自动重连（generation 递增）、`status()/probe()` 健康检查 |
| `packages/server/src/platform/store.ts` | 用户库：node:sqlite `users`/`sessions` 表、scrypt 散列、会话签发/校验/吊销、用户 CRUD |
| `packages/server/src/platform/search.ts` | 搜索服务：12 种 Provider 适配器 + 统一结果结构 + 配置持久化（`<configDir>/platform/search.json`） |
| `packages/server/src/platform/routes.ts` | 平台路由：认证（注册/登录/登出/me/改密）、用户管理 API、搜索 API、OpenWebUI 兼容 `/search`、浏览器桥状态、平台鉴权中间件 |
| `packages/server/src/platform/pages.ts` | `/login` 登录页与 `/platform/admin` 管理控制台（自渲染 HTML，零构建依赖） |
| `packages/server/src/platform/mcpRegistration.ts` | 幂等注册搜索 MCP server 到 `~/.zcode/cli/config.json`（`mcp.servers["platform-web-search"]`） |
| `packages/server/src/platform/cookies.ts` | Cookie 解析（与 http.ts 共用逻辑独立成模块） |
| `packages/server/assets/platform-search-mcp-server.mjs` | 零依赖 MCP stdio server：`web_search`、`fetch_page` 工具 |
| `packages/server/src/http.ts` | `HttpServerOptions.platform` 选项 + 平台鉴权中间件最先注册 + 平台路由挂载 |
| `deploy/Dockerfile` | 两阶段构建镜像（含 web 前端构建，禁 sourcemap 控内存） |
| `deploy/docker-compose.yml` | 一键启动：zcode + playwright（+ 可选 searxng profile） |
| `deploy/searxng/settings.yml` | SearXNG 开放 JSON format 的最小配置 |
| `docs/standalone/README.md` | 本文档 |

### 2.3 明确不改动

- `packages/web` / `packages/ui`（Web 前端 SPA 完整保留：任务、文件、终端、MCP、browser 面板）；
- agent 侧全部协议/插件代码（`bootstrap`、`core`、server-operations 的 protocol broker 原样复用）；
- `packages/zcode-cua`（桌面版 Electron CUA 保持原状，web 模式不再依赖它）。

---

## 3. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ZCODE_PLATFORM_AUTH` | 未启用 | `1` 开启自有用户/登录系统（注册/登录/会话鉴权/管理页） |
| `ZCODE_PLATFORM_SERVICE_TOKEN` | 无 | 内部服务 Bearer Token（搜索 MCP server → `/api/platform/search`） |
| `ZCODE_PLATFORM_SEARCH_MCP` | `1` | 是否自动注册搜索 MCP server；`0` 关闭 |
| `ZCODE_BROWSER_REMOTE_ENDPOINT` | 无（禁用） | 远程浏览器地址：`ws://playwright:9222/`（run-server）或 `ws://browserless:3000?token=...` / `http://host:9222`（CDP） |
| `ZCODE_BROWSER_REMOTE_MODE` | `cdp` | `playwright`=Playwright run-server 协议（需版本一致）；`cdp`=任意 CDP 端点 |
| `PORT` | `3030` | HTTP 端口 |
| `ZCODE_WEB_STATIC_ROOT` | 无 | Web SPA 静态目录（`packages/web/dist`） |

---

## 4. 一键部署（docker compose）

```bash
git clone https://github.com/cshdotcom/zcode-custom-api.git
cd zcode-custom-api
git checkout standalone

# 修改默认内部令牌（可选但建议）
export ZCODE_PLATFORM_SERVICE_TOKEN="$(openssl rand -hex 24)"

docker compose -f deploy/docker-compose.yml up -d --build

# 可选：同时启动自建 SearXNG（搜索插件可将其作为上游 Provider）
docker compose -f deploy/docker-compose.yml --profile search up -d
```

启动完成后的使用流程：

1. 打开 `http://<host>:3000/` → 自动跳转 `/login`；
2. 注册第一个账号（自动成为管理员）→ 进入 `/platform/admin` 管理控制台；
3. 在控制台「联网搜索」页选择 Provider（默认 DuckDuckGo 免 key）并保存；
4. 用管理员账号进入 ZCode 工作台，在「设置 → 模型供应商」配置模型 API Key（全平台共享）；
5. 正常使用：让 agent 联网搜索（自动走 `web_search` 工具），或让 agent 操控浏览器
   （“打开 https://example.com 并截图” → 指令转发到 playwright 容器执行，截图/DOM 坐标回传）。

### 浏览器容器的两种提供方式

**方式一（compose 默认）：Playwright run-server**

```yaml
image: mcr.microsoft.com/playwright:v1.59.1-noble
command: npx -y playwright@1.59.1 run-server --port 9222 --host 0.0.0.0
# ZCODE_BROWSER_REMOTE_MODE=playwright
```

**方式二：任意 CDP 端点（browserless / 自建 chromium）**

```yaml
image: ghcr.io/browserless/chromium:latest
environment: { TOKEN: "your-token" }
# ZCODE_BROWSER_REMOTE_ENDPOINT=ws://browserless:3000?token=your-token
# ZCODE_BROWSER_REMOTE_MODE=cdp
```

或直接裸 chromium：`chromium --headless=new --no-sandbox --remote-debugging-address=0.0.0.0 --remote-debugging-port=9222`。

CDP 模式与客户端 Playwright 版本无关，兼容性最好；`playwright` 协议模式要求
镜像版本与服务端 `playwright-core`（1.59.1）一致。

---

## 5. OpenWebUI 对接（联网搜索自定义模式兼容）

在 OpenWebUI：`管理面板 → 设置 → 联网搜索`，两种方式任选：

**方式 A：外部搜索（external）引擎**

- Web Search Engine 选 `external`；
- External Web Search URL 填 `http://<zcode-host>:3000/search`；
- External Web Search API Key 填管理页「联网搜索」中配置的对外 Token（留空则不校验）。

兼容的接口契约（POST）：

```json
// 请求
{ "query": "搜索词", "count": 5 }
// 响应（JSON 数组；出错/无结果返回 []）
[ { "link": "https://...", "title": "...", "snippet": "..." } ]
```

**方式 B：SearXNG 引擎**

- Web Search Engine 选 `searxng`；
- Query URL 填 `http://<zcode-host>:3000/search?q=<query>&format=json`。

兼容的接口契约（GET）：

```json
{ "query": "搜索词", "results": [ { "title": "...", "url": "...", "content": "...", "link": "...", "snippet": "..." } ] }
```

反向兼容：本插件的 Provider 也可选 `searxng` / `custom`，即把**别的** OpenWebUI 兼容端点
或 SearXNG 实例作为上游搜索引擎，双向互通。

---

## 6. 平台 HTTP API 一览

| 方法/路径 | 鉴权 | 说明 |
| --- | --- | --- |
| `POST /api/platform/auth/setup-status` | 无 | 是否需要初始化（首个管理员） |
| `POST /api/platform/auth/register` | 无 | 注册（首个账号自动 admin） |
| `POST /api/platform/auth/login` | 无 | 登录，签发会话 Cookie |
| `POST /api/platform/auth/logout` | 会话 | 登出并吊销会话 |
| `GET  /api/platform/auth/me` | 会话 | 当前用户信息 |
| `POST /api/platform/auth/change-password` | 会话 | 修改自己密码 |
| `GET/POST/PATCH/DELETE /api/platform/admin/users[...]` | admin | 用户管理（创建/启停/角色/重置密码/删除） |
| `GET  /api/platform/search?q=&count=` | 会话或服务令牌 | 统一搜索（多 Provider） |
| `GET/PUT /api/platform/search/config` | 会话(admin 写) | 搜索配置读取/热更新 |
| `GET  /api/platform/search/providers` | 会话 | Provider 元数据 |
| `GET  /search?q=&format=json` | 对外 Token（可选） | SearXNG 兼容 |
| `POST /search {"query","count"}` | 对外 Token（可选） | OpenWebUI external 兼容 |
| `GET  /api/platform/browser/status` | 会话 | 远程浏览器桥状态（endpoint/mode/连通性） |
| `GET  /healthz` | 无 | 健康检查 |
| `GET  /login`、`GET /platform/admin` | 见页面 | 登录页 / 管理控制台 |

---

## 7. 本地开发/验证（无 Docker）

```bash
# 1) 起一个远程浏览器（本机裸 chromium 也行）
chromium --headless=new --no-sandbox --remote-debugging-port=9222 &
# 或: node node_modules/playwright-core/cli.js run-server --port 9222   (playwright 协议模式)

# 2) 构建并启动
pnpm --filter @zcode/browser-remote build
NODE_OPTIONS=--max-old-space-size=3000 pnpm --filter @zcode/web exec vite build --sourcemap false
NODE_OPTIONS=--max-old-space-size=3000 pnpm --filter @zcode/server build

PORT=3000 \
ZCODE_WEB_STATIC_ROOT=$PWD/packages/web/dist \
ZCODE_PLATFORM_AUTH=1 \
ZCODE_PLATFORM_SERVICE_TOKEN=dev-token \
ZCODE_BROWSER_REMOTE_ENDPOINT=http://127.0.0.1:9222 \
ZCODE_BROWSER_REMOTE_MODE=cdp \
node packages/server/dist/entry-http.js

# 3) 组件级验证脚本（仓库外）
node scripts/test-browser-remote.mjs http://127.0.0.1:9222   # 浏览器执行桥全链路
node scripts/test-mcp-search.mjs                             # MCP server 协议
```

---

## 8. 能力边界与说明

- agent 端浏览器能力由上游 browser-use 插件驱动：`agent.browsers.list()` 会列出
  `ZCode Remote Chromium`（backend type `cdp`），模型按 `control-browser` skill 的
  DOM snapshot → locator → act 流程操作，与桌面版一致的模型侧体验；
- web 版没有桌面版「用户自己的浏览器标签页」概念，`BrowserUser.openTabs`、`history`、
  文件下载等在远程无头模式下不支持（与上游 managed headless CDP 的能力矩阵一致，
  由 `apiSupportOverrides` 声明，模型会自动避开）；
- 搜索 Provider 的可用性取决于部署环境的出网能力与各家 API 配额；DuckDuckGo 免密钥
  但可能遇到限流，生产建议 Tavily/博查/SearXNG；
- `fetch_page` 工具会以服务端身份抓取 URL，仅支持 http/https 并做超时与长度截断。
