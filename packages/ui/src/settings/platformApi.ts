/**
 * 平台 API 客户端（设置页「平台中心 / 平台管理」分区专用）：
 * 全部走同源 /api/platform/*，Cookie 会话由浏览器自动携带。
 */

export interface PlatformUserRow {
  id: string;
  username: string;
  role: "admin" | "user" | "pending";
  status: "active" | "disabled";
  displayName?: string;
  groupIds: string[];
  groupNames: string[];
  createdAt: number;
  lastLoginAt?: number;
}

export interface PlatformInviteRow {
  code: string;
  maxUses: number;
  uses: number;
  expiresAt?: number;
  defaultRole?: "user" | "pending";
  note?: string;
  disabled: boolean;
  createdBy?: string;
  createdAt: number;
}

export interface PlatformGroupRow {
  id: string;
  name: string;
  description?: string;
  permissions: Record<string, boolean>;
  memberIds: string[];
  memberNames?: string[];
  createdAt: number;
}

export interface PlatformShareRow {
  token: string;
  resourceType: "session" | "task" | "project";
  resourceId: string;
  title: string;
  visibility: "open" | "public";
  viewCount: number;
  ownerId: string;
  createdAt: number;
  updatedAt?: number;
}

export interface PlatformSystemConfig {
  enableSignup: boolean;
  requireInvite: boolean;
  defaultRole: "user" | "pending";
  loginNotice: string;
  pendingNotice: string;
  announcementEnabled: boolean;
  announcementTitle: string;
  announcementBody: string;
  gatewayEnabled: boolean;
  gatewayBaseUrl: string;
  gatewayApiKey: string;
  gatewayModels: string;
}

export interface PlatformSearchConfig {
  provider: string;
  count: number;
  apiKey?: string;
  baseUrl?: string;
  engine?: string;
  apiToken?: string;
}

export interface PlatformBrowserStatus {
  enabled: boolean;
  endpoint?: string;
  mode?: string;
  connected?: boolean;
  detail?: string;
}

export interface PlatformPromptRow {
  id: string;
  ownerId?: string;
  ownerUsername?: string;
  title: string;
  content: string;
  /** 斜杠命令（可选）：聊天输入 /命令 触发展开。 */
  command?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlatformKbDocRow {
  id: string;
  title: string;
  filename?: string;
  size: number;
  chunkCount: number;
  createdAt: number;
  ownerId?: string;
  ownerUsername?: string;
}

export interface PlatformStatsRow {
  users: number;
  pendingUsers: number;
  activeSessions: number;
  shares: number;
  prompts: number;
  kbDocs: number;
  logins24h: number;
  searches24h: number;
}

export interface PlatformEventRow {
  id: number;
  type: string;
  userId?: string;
  username?: string;
  detail?: string;
  createdAt: number;
}

export class PlatformApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PlatformApiError";
    this.status = status;
  }
}

export async function platformApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `HTTP ${response.status}`;
    throw new PlatformApiError(message, response.status);
  }
  return data as T;
}

export function platformApiDelete(path: string): Promise<{ ok?: boolean }> {
  return platformApi<{ ok?: boolean }>(path, { method: "DELETE" });
}
