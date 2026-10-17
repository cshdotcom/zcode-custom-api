import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 把平台 MCP server 注册进 ZCode CLI 的用户级 MCP 配置（~/.zcode/cli/config.json → mcp.servers）。
 * 幂等合并：只增改 platform-web-search / platform-knowledge 两个条目，不动其它配置。
 */

interface McpServerSpec {
  key: string;
  script: string;
  envKey: string;
  description: string;
}

const SERVER_SPECS: McpServerSpec[] = [
  {
    key: "platform-web-search",
    script: "platform-search-mcp-server.mjs",
    envKey: "ZCODE_PLATFORM_SEARCH_TOKEN",
    description: "ZCode 平台联网搜索（web_search / fetch_page）",
  },
  {
    key: "platform-knowledge",
    script: "platform-knowledge-mcp-server.mjs",
    envKey: "ZCODE_PLATFORM_KB_TOKEN",
    description: "ZCode 平台知识库检索（search_knowledge）",
  },
];

function resolveMcpServerScriptPath(script: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // 打包产物：dist/entry-http.js → dist/assets/...
    resolve(join(here, "assets", script)),
    // 打包产物（assets 未随 dist 拷贝时）：dist → ../assets
    resolve(join(here, "..", "assets", script)),
    // 源码树直跑：src/platform → ../../assets
    resolve(join(here, "..", "..", "assets", script)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`platform MCP server script not found: ${candidates.join(", ")}`);
}

export async function registerPlatformMcpServers(options: {
  configDir: string;
  serviceToken?: string;
  enabled?: boolean;
}): Promise<void> {
  if (options.enabled === false) return;

  const scripts: Array<{ spec: McpServerSpec; path: string }> = [];
  for (const spec of SERVER_SPECS) {
    try {
      scripts.push({ spec, path: resolveMcpServerScriptPath(spec.script) });
    } catch (error) {
      console.warn(
        `[zcode-server:platform] MCP registration skipped for ${spec.key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (scripts.length === 0) return;

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

  for (const { spec, path } of scripts) {
    const env: Record<string, string> = {};
    if (options.serviceToken) env[spec.envKey] = options.serviceToken;
    const existing = serversSection[spec.key];
    const desired = {
      type: "stdio",
      command: process.execPath,
      args: [path],
      env,
      enabled: true,
      description: spec.description,
    };
    if (
      existing &&
      existing["command"] === desired.command &&
      JSON.stringify(existing["args"]) === JSON.stringify(desired.args) &&
      JSON.stringify(existing["env"]) === JSON.stringify(desired.env) &&
      existing["enabled"] === true
    ) {
      continue;
    }
    serversSection[spec.key] = desired;
    console.log(
      `[zcode-server:platform] MCP server registered at ${configPath} (key: ${spec.key})`,
    );
  }

  mcpSection["servers"] = serversSection;
  config["mcp"] = mcpSection;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

/**
 * 兼容旧调用方：只注册搜索 MCP server。
 */
export async function registerPlatformSearchMcpServer(options: {
  configDir: string;
  port: number;
  serviceToken?: string;
  enabled?: boolean;
}): Promise<void> {
  await registerPlatformMcpServers(options);
}
