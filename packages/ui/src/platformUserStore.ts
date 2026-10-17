import { useSyncExternalStore } from "react";

/**
 * 平台用户状态（自有用户系统）：登录门在 SPA 启动时写入，
 * 设置页「平台中心 / 平台管理」分区据此控制可见性与能力。
 *
 * 深度融合约定：platformUser 为 null 且平台认证已启用时，SPA 显示登录门；
 * 为 null 且平台认证未启用（桌面端 / 本地开发）时，一切按官方默认行为运行。
 */

export type PlatformUserRole = "admin" | "user" | "pending";
export type PlatformUserStatus = "active" | "disabled";

export interface PlatformUserInfo {
  id: string;
  username: string;
  role: PlatformUserRole;
  status: PlatformUserStatus;
  displayName?: string;
  permissions: {
    canShare: boolean;
    canSharePublicly: boolean;
  };
}

export interface PlatformAuthConfig {
  /** 平台认证是否启用（ZCODE_PLATFORM_AUTH=1）。未启用时登录门不生效。 */
  enabled: boolean;
  needsSetup: boolean;
  registrationOpen: boolean;
  requireInvite: boolean;
  notice?: string;
}

type Listener = () => void;

let platformUser: PlatformUserInfo | null = null;
let platformAuthConfig: PlatformAuthConfig = { enabled: false, needsSetup: false, registrationOpen: false, requireInvite: false };
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setPlatformUser(user: PlatformUserInfo | null): void {
  platformUser = user;
  emit();
}

export function getPlatformUser(): PlatformUserInfo | null {
  return platformUser;
}

export function setPlatformAuthConfig(config: PlatformAuthConfig): void {
  platformAuthConfig = config;
  emit();
}

export function getPlatformAuthConfig(): PlatformAuthConfig {
  return platformAuthConfig;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePlatformUser(): PlatformUserInfo | null {
  return useSyncExternalStore(subscribe, getPlatformUser, getPlatformUser);
}
