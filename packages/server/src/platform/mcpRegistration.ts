import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 把平台搜索 MCP server 注册进 ZCode CLI 的用户级 MCP 配置（~/.zcode/cli/config.json → mcp.servers）。
 * 幂等合并：只增改 platform-web-search 一个条目，不动其它配置。
 */

const SERVER_KEY = "platform-web-search";

function resolveMcpServerScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // 打包产物：dist/entry-http.js → dist/assets/...
    resolve(join(here, "assets", "platform-search-mcp-server.mjs")),
    // 打包产物（assets 未随 dist 拷贝时）：dist → ../assets
    resolve(join(here, "..", "assets", "platform-search-mcp-server.mjs")),
    // 源码树直跑：src/platform → ../../assets
    resolve(join(here, "..", "..", "assets", "platform-search-mcp-server.mjs")),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`platform search MCP server script not found: ${candidates.join(", ")}`);
}

export async function registerPlatformSearchMcpServer(options: {
  configDir: string;
  port: number;
  serviceToken?: string;
  enabled?: boolean;
}): Promise<void> {
  if (options.enabled === false) return;
  let scriptPath: string;
  try {
    scriptPath = resolveMcpServerScriptPath();
  } catch (error) {
    console.warn(`[zcode-server:platform] search MCP registration skipped: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  // config.json 在 <dataRoot>/cli/config.json（与 getAppConfigDir()= <dataRoot>/v2 平级的 cli 目录）。
  const cliConfigDir = join(dirname(options.configDir), "cli");
  const configPath = join(cliConfigDir, "config.json");
  mkdirSync(cliConfigDir, { recursive: true });

  let config: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      config = parsed as Record<string, unknown>;
    }
  } catch {
    config = {};
  }

  const mcpSection =
    config["mcp"] && typeof config["mcp"] === "object" && !Array.isArray(config["mcp"])
      ? { ...(config["mcp"] as Record<string, unknown>) }
      : {};
  const serversSection =
    mcpSection["servers"] && typeof mcpSection["servers"] === "object" && !Array.isArray(mcpSection["servers"])
      ? { ...(mcpSection["servers"] as Record<string, Record<string, unknown>>) }
      : {};

  const existing = serversSection[SERVER_KEY];
  const desired = {
    type: "stdio",
    command: process.execPath,
    args: [scriptPath],
    env: {
      ...(options.serviceToken ? { ZCODE_PLATFORM_SEARCH_TOKEN: options.serviceToken } : {}),
    },
    enabled: true,
    description: "ZCode 平台联网搜索（web_search / fetch_page）",
  };
  if (
    existing &&
    existing["command"] === desired.command &&
    JSON.stringify(existing["args"]) === JSON.stringify(desired.args) &&
    JSON.stringify(existing["env"]) === JSON.stringify(desired.env) &&
    existing["enabled"] === true
  ) {
    return;
  }

  serversSection[SERVER_KEY] = desired;
  mcpSection["servers"] = serversSection;
  config["mcp"] = mcpSection;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  console.log(`[zcode-server:platform] search MCP server registered at ${configPath} (key: ${SERVER_KEY})`);
}
