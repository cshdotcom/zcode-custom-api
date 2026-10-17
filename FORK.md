# ZCode Custom API Fork

基于 [zai-org/ZCode](https://github.com/zai-org/ZCode) v3.15.1 的修改版本，在欢迎页原生支持**任意 OpenAI / Anthropic 兼容自定义 API**，无需 Z.ai 账号即可使用自己的模型服务。

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
