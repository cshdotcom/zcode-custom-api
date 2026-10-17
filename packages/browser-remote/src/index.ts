import {
  createManagedCdpBrowserRuntime,
  type ManagedCdpBrowserRuntime,
  type ManagedCdpRemoteEndpointOptions,
} from "@zcode/adapters/browser";
import type { BrowserCommand } from "@zcode/contracts";
import type { BrowserBackendDescriptor as SharedBrowserBackendDescriptor } from "@zcode/shared";

/**
 * ZCode Server 侧浏览器远程执行桥（BrowserAmbientContextExecutor 形状）。
 *
 * 架构：浏览器 ZCode Web 前端 ↔ ZCode Server（本执行桥）↔ 远程 Playwright/CDP 浏览器容器。
 * agent 进程的 agent.browsers.* 调用经 ZCode Protocol 的 interaction/browserList /
 * interaction/browserExecute 反向请求到达 zcodeAgentService，服务把请求转发到这里，
 * 由 @zcode/adapters 的 ManagedCdpBrowserControlPort 翻译为 Playwright 命令在远程容器执行。
 *
 * 类型说明：@zcode/adapters 的 BrowserControlPort 使用 apps/zcode-cli/packages/contracts 的
 * BrowserCommand/BrowserCommandResult（zod v3 镜像）；本桥接层对外的形状与 @zcode/shared
 * 的 browser-use 契约同构（zod v4）。两侧结构镜像由上游 round-trip 测试保证，桥接处做显式
 * 类型桥（as unknown as），运行时结果仍由 agent 侧 zod schema 校验。
 */

/** 与 @zcode/services 的 BrowserAmbientContextExecutor 结构兼容的本地最小接口。 */
export interface PlatformBrowserControlExecutor {
  list(input: {
    requestId: string;
    sessionId: string;
    turnId?: string;
    workspaceKey?: string;
    workspacePath?: string;
    workspaceIdentity?: string;
    remoteSessionId?: string;
    clientMode?: string;
    sessionContext?: string;
  }): Promise<SharedBrowserBackendDescriptor[]>;
  execute(input: {
    requestId: string;
    browserId?: string;
    browserGeneration?: number;
    sessionId: string;
    turnId?: string;
    workspaceKey?: string;
    workspacePath?: string;
    workspaceIdentity?: string;
    remoteSessionId?: string;
    clientMode?: string;
    sessionContext?: string;
    command: unknown;
  }): Promise<{ ok: boolean; [key: string]: unknown }>;
}

export interface RemoteBrowserExecutorStatus {
  endpoint: string;
  mode: "cdp" | "playwright";
  /** 最近一次 list() 是否成功拿到 backend descriptor。 */
  available: boolean;
  lastError?: string;
  lastCheckedAt?: number;
  descriptor?: SharedBrowserBackendDescriptor;
}

export interface RemoteBrowserExecutor extends PlatformBrowserControlExecutor {
  status(): RemoteBrowserExecutorStatus;
  /** 主动探测远程浏览器连通性（健康检查端点用）。 */
  probe(): Promise<RemoteBrowserExecutorStatus>;
  close(): Promise<void>;
}

export function createRemoteBrowserExecutor(
  options: ManagedCdpRemoteEndpointOptions,
): RemoteBrowserExecutor {
  let runtime: ManagedCdpBrowserRuntime | undefined;
  let cachedDescriptor: SharedBrowserBackendDescriptor | undefined;
  let available = false;
  let lastError: string | undefined;
  let lastCheckedAt: number | undefined;

  const ensureRuntime = (): ManagedCdpBrowserRuntime => {
    runtime ??= createManagedCdpBrowserRuntime({ remote: options });
    return runtime;
  };

  const refresh = async (sessionId: string, turnId?: string): Promise<void> => {
    lastCheckedAt = Date.now();
    try {
      // list() 内部 ensureBrowser：懒连接远程浏览器容器；失败抛错。
      const descriptors = await ensureRuntime().browserControlPort.list({
        sessionId,
        ...(turnId !== undefined ? { turnId } : {}),
      });
      const first = descriptors[0];
      if (!first) throw new Error("remote browser returned no backend descriptor");
      cachedDescriptor = first as unknown as SharedBrowserBackendDescriptor;
      available = true;
      lastError = undefined;
    } catch (error) {
      available = false;
      cachedDescriptor = undefined;
      lastError = error instanceof Error ? error.message : String(error);
    }
  };

  const executor: RemoteBrowserExecutor = {
    async list(input) {
      await refresh(input.sessionId, input.turnId);
      return available && cachedDescriptor ? [cachedDescriptor] : [];
    },

    async execute(input) {
      const startedAt = Date.now();
      const command = input.command;
      const commandMethod =
        typeof command === "object" && command !== null && "method" in command
          ? String((command as { method: unknown }).method)
          : "unknown";
      // execute 需要精确 browserId/generation；未携带时用最近一次 list() 的 descriptor 补齐。
      if (!input.browserId || input.browserGeneration === undefined) {
        if (!cachedDescriptor) await refresh(input.sessionId, input.turnId);
        if (!cachedDescriptor) {
          return {
            ok: false,
            error: {
              code: "backend_unavailable",
              message: lastError
                ? `Remote browser is unavailable: ${lastError}`
                : "Remote browser is unavailable: no backend descriptor has been discovered yet",
            },
            elapsedMs: Date.now() - startedAt,
          };
        }
        input.browserId = cachedDescriptor.id;
        input.browserGeneration = cachedDescriptor.generation;
      }
      try {
        const result = (await ensureRuntime().browserControlPort.execute({
          browserId: input.browserId,
          browserGeneration: input.browserGeneration,
          sessionId: input.sessionId,
          ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
          command: command as BrowserCommand,
        })) as unknown as { ok: boolean; [key: string]: unknown };
        // 执行成功说明 backend 可用；失败若是 backend_unavailable 则刷新可用性缓存。
        if (result.ok) {
          available = true;
          lastError = undefined;
        } else {
          const code = (result as { error?: { code?: string } }).error?.code;
          if (code === "backend_unavailable") await refresh(input.sessionId, input.turnId);
        }
        return result;
      } catch (error) {
        // port.execute 正常情况下把错误折叠进结果；能到这里说明 runtime 层异常。
        available = false;
        lastError = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: {
            code: "backend_unavailable",
            message: `Remote browser command '${commandMethod}' failed: ${lastError}`,
          },
          elapsedMs: Date.now() - startedAt,
        };
      }
    },

    status() {
      return {
        endpoint: options.endpoint,
        mode: options.mode,
        available,
        ...(lastError !== undefined ? { lastError } : {}),
        ...(lastCheckedAt !== undefined ? { lastCheckedAt } : {}),
        ...(cachedDescriptor ? { descriptor: cachedDescriptor } : {}),
      };
    },

    async probe() {
      await refresh("platform-health-probe");
      return executor.status();
    },

    close: async () => {
      await runtime?.close();
      runtime = undefined;
      available = false;
      cachedDescriptor = undefined;
    },
  };

  return executor;
}

export type { ManagedCdpRemoteEndpointOptions };
