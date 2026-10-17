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

# 附录：欢迎页自定义 API Provider（阶段一，已回移本分支）

## 相比上游的修改

| # | 文件 | 修改内容 |
|---|------|----------|
| 1 | `packages/ui/src/login/LoginApiKeyForm.helpers.ts` | `ApiKeyProviderChoice` 新增 `custom` 选项；新增 `parseLoginCustomModelIds()` 模型 ID 解析（支持逗号/空白分隔、去重） |
| 2 | `packages/ui/src/login/LoginApiKeyForm.tsx` | 欢迎页 API Key 表单新增「自定义 API」分支：API 格式（anthropic-messages / openai-chat-completions / openai-responses）、Base URL、模型 ID 列表三个字段；保存时创建标准个人 Provider 并批量添加模型、设为默认模型 |
| 3 | `packages/ui/src/root/useProviderAvailabilityLoginEntryGuard.ts` | 登录守卫调整：家族域缺失但存在可用 Provider（自定义 API）时不再强制弹出登录入口 |
| 4 | `packages/ui/src/i18n/locales/zh-CN.ts` / `en-US.ts` | 新增 `login.apiKey.custom.*` 中英文文案 |

## 自定义 API 使用方式

### 方式一：欢迎页图形界面（本 Fork 新增）

1. 启动后打开 Web 界面 → 点击 **Use API key**
2. Provider 下拉选择 **自定义 API（OpenAI / Anthropic 兼容）**
3. 填写：
   - **API 格式**：Anthropic Messages（`/v1/messages`）、OpenAI Chat Completions（`/chat/completions`）或 OpenAI Responses（`/responses`）
   - **Base URL**：如 `https://open.bigmodel.cn/api/paas/v4`、`https://api.example.com/v1`
   - **模型 ID**：多个用英文逗号分隔，如 `glm-4.7, glm-4.7-air`
   - **API Key**
4. 点击「继续」→ Provider 持久化到 `~/.zcode/v2/provider_config.json` 并自动设为默认模型

### 方式二：直接写配置文件

```json
{
  "schemaVersion": 1,
  "config": {
    "providerOrder": ["my-provider"],
    "providerConfigRules": {
      "providerRules": [
        {
          "providerId": "my-provider",
          "providerName": "My API",
          "config": {
            "group": "standard-personal",
            "access": { "type": "api-key", "apiKey": "sk-xxx" },
            "api": { "type": "openai-chat-completions", "baseUrl": "https://api.example.com/v1" },
            "personalModelIds": ["model-a"],
            "modelOrder": ["model-a"]
          }
        }
      ]
    },
    "modelConfigRules": {
      "providerModelRules": [
        { "modelId": "model-a", "config": { "enabled": true }, "providerId": "my-provider" }
      ]
    }
  }
}
```

也可通过环境变量重定向：`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`、`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`、`ZCODE_DATA_BASE_DIR`。

### 方式三：设置页

Settings → 模型供应商 → 添加供应商 → 创建自定义供应商（上游已有能力）。

## 启动方式

### 开发模式（Web）

```bash
pnpm install
pnpm -r --filter @zcode/server... --filter @zcode/web... build
pnpm dev:web
# 浏览器访问 http://localhost:5173（后端 :3030）
```

### 生产静态托管（单进程，推荐部署）

```bash
cd packages/web && npx vite build --sourcemap false
ZCODE_WEB_STATIC_ROOT=$(pwd)/packages/web/dist PORT=3000 pnpm --filter @zcode/server dev
# 浏览器访问 http://localhost:3000
```

`> v3.15.1-custom-api.1` 标签对应本 Fork 的首个修改版本。
