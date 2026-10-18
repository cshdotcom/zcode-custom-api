/* 平台每用户数据隔离（standalone-deep-integration 定制）。
 *
 * 背景：ZCode 单进程多用户部署时，CLI 会话库（{dataRoot}/cli/db/db.sqlite）、
 * 任务索引、provider 配置与工作区 cwd 默认全部共享，跨用户数据互相可见，
 * 存在严重的安全风险。对齐 OpenWebUI 的"所有数据带 user_id"语义，本模块以
 * 「每用户独立数据根 + 独立工作区目录」实现进程级隔离：
 *
 *   ZCODE_PLATFORM_USERS_ROOT=/data/users（启用开关；未设置 = 完全兼容旧行为）
 *     {root}/{userId}/workspace   ← workspacePath 重定向目标（CLI cwd / 文件 / git / 终端）
 *     {root}/{userId}/data        ← ZCODE_DATA_BASE_DIR（CLI 会话库/任务索引/配置根）
 *
 * 注入路径（双层，服务端强制）：
 *  1. http.ts 连接层：已认证平台用户的每个 RPC 连接，通过
 *     wrapServiceArgsWithPlatformIsolation 覆写所有出参里的
 *     workspacePath / workspaceIdentity，前端无法越权指定他人路径。
 *  2. zcodeAgentProcessManager spawn 层：按 workspacePath 推导
 *     ZCODE_DATA_BASE_DIR（buildPlatformUserIsolationEnv），CLI 子进程的
 *     会话库、任务索引、setting.json、MCP 配置全部落到用户私有目录；
 *     即使上层漏覆写，数据也不会再合并进全局库。
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const PLATFORM_USERS_ROOT_ENV = "ZCODE_PLATFORM_USERS_ROOT";

const log = (...args: unknown[]) =>
  console.log("[zcode-server:platform-isolation]", ...args);

/** 平台用户数据根；未启用返回 undefined。 */
export function getPlatformUsersRoot(): string | undefined {
  const root = process.env[PLATFORM_USERS_ROOT_ENV]?.trim();
  return root ? root : undefined;
}

/** 某平台用户的隔离工作区路径。 */
export function platformUserWorkspacePath(usersRoot: string, userId: string): string {
  return join(usersRoot, userId, "workspace");
}

/** 某平台用户的隔离数据根（ZCODE_DATA_BASE_DIR 目标）。 */
export function platformUserDataPath(usersRoot: string, userId: string): string {
  return join(usersRoot, userId, "data");
}

/** workspaceIdentity 约定前缀：同一物理路径在不同用户语义下是不同 agent 池。 */
export function platformUserIdentity(userId: string): string {
  return `platform-user:${userId}`;
}

/**
 * spawn 层：由 workspacePath 推导 CLI 子进程的隔离数据根。
 * 仅当 workspacePath 位于 {usersRoot}/{userId}/workspace 时生效；
 * 命中则确保目录存在并返回 ZCODE_DATA_BASE_DIR 注入项，否则返回空对象。
 */
export function buildPlatformUserIsolationEnv(
  workspacePath: string,
): Record<string, string> {
  const usersRoot = getPlatformUsersRoot();
  if (!usersRoot || !workspacePath) return {};
  const normalizedRoot = usersRoot.replace(/\/+$/, "");
  if (!workspacePath.startsWith(`${normalizedRoot}/`)) return {};
  const rest = workspacePath.slice(normalizedRoot.length + 1);
  const segments = rest.split("/");
  if (segments.length < 2 || segments[1] !== "workspace") return {};
  const userId = segments[0];
  if (!userId || userId.includes("..")) return {};

  const dataDir = platformUserDataPath(normalizedRoot, userId);
  for (const dir of [dataDir, workspacePath]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  log(`user data isolation active`, { userId, dataDir, workspacePath });
  return {
    ZCODE_DATA_BASE_DIR: dataDir,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 连接层：包装服务实例，覆写所有出参中的 workspacePath / workspaceIdentity。
 * - workspacePath → 本用户隔离工作区（目录不存在则创建）
 * - workspaceIdentity → platform-user:{userId}（agent 池按用户分桶）
 * 参数不是普通对象时原样透传；未启用隔离时原样返回服务实例（零开销）。
 */
export function wrapServiceWithPlatformIsolation<T extends object>(
  service: T,
  userId: string,
): T {
  const usersRoot = getPlatformUsersRoot();
  if (!usersRoot) return service;
  const workspacePath = platformUserWorkspacePath(usersRoot, userId);
  const dataPath = platformUserDataPath(usersRoot, userId);
  if (!existsSync(workspacePath)) {
    mkdirSync(workspacePath, { recursive: true });
  }
  if (!existsSync(dataPath)) {
    mkdirSync(dataPath, { recursive: true });
  }
  const identity = platformUserIdentity(userId);

  return new Proxy(service, {
    get(target, prop, receiver) {
      const raw = Reflect.get(target, prop, receiver);
      if (typeof raw !== "function") return raw;
      return (...args: unknown[]) => {
        const mapped = args.map((arg) => {
          if (!isPlainObject(arg)) return arg;
          let next = arg;
          let changed = false;
          if (typeof arg.workspacePath === "string" && arg.workspacePath) {
            next = { ...next, workspacePath };
            changed = true;
          }
          if ("workspaceIdentity" in arg) {
            next = { ...next, workspaceIdentity: identity };
            changed = true;
          }
          return changed ? next : arg;
        });
        return raw.apply(target, mapped);
      };
    },
  });
}
