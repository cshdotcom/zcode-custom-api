# ZCode Fork（cshdotcom/zcode-custom-api）

本仓库是 zai-org/ZCode（v3.15.1）的 fork，包含以下分支：

| 分支 | 内容 |
| --- | --- |
| `original` | 上游 v3.15.1 纯净代码（未做任何修改） |
| `main` | 自定义 API 修改版：欢迎页支持自定义 Provider（API 格式/Base URL/模型 ID），tag `v3.15.1-custom-api.1` |
| `standalone` | **独立平台版**：远程浏览器 CUA（Playwright 容器）+ 联网搜索插件（OpenWebUI 兼容）+ 自有用户/登录系统 |

## standalone 分支

三大能力（Web 前端零改动，全部在 Server 层注入）：

1. **远程浏览器自动化（替换 web 版 zcode-cua 占位 stub）**
   - 架构：浏览器 ZCode Web 前端 ↔ ZCode Server ↔ 独立 Playwright/CDP 浏览器容器
   - AI 可自动访问网页、点击元素、输入文字、截图、拾取 DOM 元素坐标
   - 配置：`ZCODE_BROWSER_REMOTE_ENDPOINT` + `ZCODE_BROWSER_REMOTE_MODE=playwright|cdp`
2. **联网搜索插件**
   - 12 种 Provider（DuckDuckGo/Tavily/Brave/Google/Bing/Serper/SearXNG/Jina/Exa/博查/智谱/OpenWebUI 兼容自定义），管理页热切换
   - Agent 工具：`web_search` / `fetch_page`（零依赖 MCP stdio server，自动注册）
   - 对外兼容 OpenWebUI：POST `/search`（external 模式）与 GET `/search?q=&format=json`（SearXNG 模式）
3. **自有用户管理 + 登录系统（替代官方登录）**
   - `ZCODE_PLATFORM_AUTH=1` 启用；首个注册账号自动成为管理员
   - node:sqlite 用户库（零 native 依赖）、scrypt 口令散列、可吊销会话
   - `/platform/admin` 管理控制台：用户管理、搜索配置、浏览器桥状态

### 一键部署

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

详见 [docs/standalone/README.md](docs/standalone/README.md)（完整方案、修改文件清单、环境变量、API 一览、OpenWebUI 对接）。

### 关键环境变量

| 变量 | 说明 |
| --- | --- |
| `ZCODE_PLATFORM_AUTH=1` | 启用自有用户/登录系统 |
| `ZCODE_PLATFORM_SERVICE_TOKEN` | 内部服务令牌（搜索 MCP server 用） |
| `ZCODE_BROWSER_REMOTE_ENDPOINT` | 远程浏览器地址（如 `ws://playwright:9222/`） |
| `ZCODE_BROWSER_REMOTE_MODE` | `playwright`（run-server 协议）或 `cdp`（任意 CDP 端点） |
