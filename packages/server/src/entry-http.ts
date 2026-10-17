import { createLocalServices, createTopicResourcePeers, getAppConfigDir } from "@zcode/services/node";
import { join } from "node:path";
import {
  materializeBundledZCodeBuiltinProviderConfig,
  readBundledZCodeBuiltinProviderConfig,
} from "./bundledZCodeBuiltinProviderConfig.js";
import { createHttpServer } from "./http.js";
import { PlatformStore } from "./platform/store.js";
import { SearchService } from "./platform/search.js";
import { createRemoteBrowserExecutor, type RemoteBrowserExecutor } from "@zcode/browser-remote";
import { registerPlatformSearchMcpServer } from "./platform/mcpRegistration.js";

async function main(): Promise<void> {
  const configDir = getAppConfigDir();
  const zcodeBuiltinProviderConfigFilePath = await materializeBundledZCodeBuiltinProviderConfig({
    environmentConfigRoot: configDir,
    content: readBundledZCodeBuiltinProviderConfig(),
  });
  const port = Number(process.env["PORT"]) || 3030;
  const host = process.env["ZCODE_SERVER_HOST"]?.trim() || process.env["HOST"]?.trim() || undefined;
  const staticRoot = process.env["ZCODE_WEB_STATIC_ROOT"]?.trim() || undefined;
  const authToken = process.env["ZCODE_SERVER_AUTH_TOKEN"]?.trim() || undefined;

  // ---------- 平台层：自有用户系统 + 联网搜索 + 远程浏览器桥 ----------
  const platformAuthEnabled =
    process.env["ZCODE_PLATFORM_AUTH"]?.trim() === "1" ||
    process.env["ZCODE_PLATFORM_AUTH"]?.trim() === "true";
  const serviceToken = process.env["ZCODE_PLATFORM_SERVICE_TOKEN"]?.trim() || undefined;

  // 远程浏览器（Playwright 容器 / CDP 端点）。配置后 agent 的浏览器操控能力经
  // interaction/browserExecute 反向请求桥接到远程浏览器执行（替代桌面 Electron CUA）。
  const remoteEndpoint = process.env["ZCODE_BROWSER_REMOTE_ENDPOINT"]?.trim() || undefined;
  const remoteModeRaw = process.env["ZCODE_BROWSER_REMOTE_MODE"]?.trim().toLowerCase();
  const remoteMode: "cdp" | "playwright" =
    remoteModeRaw === "playwright" || remoteModeRaw === "cdp" ? remoteModeRaw : "cdp";
  let browserExecutor: RemoteBrowserExecutor | undefined;
  if (remoteEndpoint) {
    browserExecutor = createRemoteBrowserExecutor({
      endpoint: remoteEndpoint,
      mode: remoteMode,
      connectTimeoutMs: 15_000,
    });
    console.log(
      `[zcode-server:platform] remote browser bridge enabled: ${remoteEndpoint} (mode: ${remoteMode})`,
    );
  } else {
    console.log(
      "[zcode-server:platform] remote browser bridge disabled (set ZCODE_BROWSER_REMOTE_ENDPOINT to enable)",
    );
  }

  const store = platformAuthEnabled
    ? new PlatformStore(join(configDir, "platform"))
    : undefined;
  const search = new SearchService(configDir);
  if (platformAuthEnabled) {
    store!.purgeExpiredSessions();
    console.log(`[zcode-server:platform] auth enabled (users.db: ${store!.filePath})`);
  }

  // 搜索 MCP server 注册（agent 工具接入）：写入 mcp.json 的 platform-web-search 条目。
  await registerPlatformSearchMcpServer({
    configDir,
    port,
    ...(serviceToken ? { serviceToken } : {}),
    enabled: process.env["ZCODE_PLATFORM_SEARCH_MCP"]?.trim() !== "0",
  });

  const topicResourcePeers = createTopicResourcePeers();
  const services = createLocalServices({
    topicResourceRelayChannel: (request) => topicResourcePeers.getChannel(request),
    zcodeBuiltinProviderConfigFilePath,
    providerProvisioningTargetEnabled: Boolean(authToken),
    ...(browserExecutor ? { browserControlExecutor: browserExecutor } : {}),
  });

  createHttpServer(services, port, {
    topicResourcePeers,
    ...(host ? { host } : {}),
    ...(staticRoot ? { staticRoot, spaFallback: true } : {}),
    ...(authToken ? { authToken, authRequired: true } : {}),
    ...(store
      ? {
          platform: {
            authEnabled: true,
            store,
            search,
            ...(browserExecutor ? { browser: browserExecutor } : {}),
            ...(serviceToken ? { serviceToken } : {}),
          },
        }
      : {}),
  });
}

void main().catch((error: unknown) => {
  console.error("[zcode-server:http] startup failed", error);
  process.exitCode = 1;
});
