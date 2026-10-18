import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

// tsup/esbuild 会把 import("node:sqlite") 错误改写为 import("sqlite")，运行时报
// ERR_MODULE_NOT_FOUND。createRequire 能稳定保留 node: 协议（同 packages/desktop 的处理）。
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

/**
 * 平台用户存储：node:sqlite（Node 24 内置，无 native 依赖）。
 *
 * 职责（OpenWebUI 风格的自托管用户体系）：
 * - 注册 / 登录校验（scrypt 口令散列）/ 会话签发与校验（可吊销）
 * - 三级角色 admin/user/pending（pending = 注册后待管理员审批）
 * - 用户组（groups + group_members）与点分键权限树（hasPermission，任一组放行即通过）
 * - 邀请码（invites）：限额 / 有效期 / 注册默认角色，OpenWebUI 没有的自建能力
 * - 系统配置（config 表）：注册开关 / 邀请码必填 / 默认角色 / 登录页公告，env 默认 + DB 覆盖
 * - 分享（shares）：对话/任务/项目快照 + 可见性（open=免登录 / public=需登录）
 * 首个注册用户自动成为 admin。
 */

export type PlatformUserRole = "admin" | "user" | "pending";
export type PlatformUserStatus = "active" | "disabled";
export type ShareVisibility = "open" | "public";
export type ShareResourceType = "session" | "task" | "project";

export interface PlatformUser {
  id: string;
  username: string;
  displayName?: string;
  role: PlatformUserRole;
  status: PlatformUserStatus;
  createdAt: number;
  lastLoginAt?: number;
  /** 邮箱（可选，OpenWebUI user.email 对应）。 */
  email?: string;
  /** 个人简介（OpenWebUI user.bio 对应）。 */
  bio?: string;
  /** 头像：data-URI（OpenWebUI profile_image_url 同款，无文件系统依赖）。 */
  avatarUrl?: string;
}

export interface PlatformSession {
  token: string;
  userId: string;
  expiresAt: number;
}

export interface PlatformGroup {
  id: string;
  name: string;
  description?: string;
  permissions: Record<string, boolean>;
  createdBy?: string;
  createdAt: number;
  memberCount?: number;
  memberIds?: string[];
}

export interface PlatformInvite {
  code: string;
  createdBy?: string;
  maxUses: number; // 0 = 不限次数
  usedCount: number;
  expiresAt?: number;
  defaultRole?: Exclude<PlatformUserRole, "admin">;
  note?: string;
  disabled: boolean;
  createdAt: number;
}

export interface PlatformShare {
  token: string;
  resourceType: ShareResourceType;
  resourceId: string;
  title: string;
  visibility: ShareVisibility;
  ownerId: string;
  ownerUsername?: string;
  snapshot: unknown;
  viewCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlatformConfig {
  enableSignup: boolean;
  requireInvite: boolean;
  defaultRole: "user" | "pending";
  loginNotice?: string;
  pendingNotice: string;
  announcementEnabled: boolean;
  announcementTitle?: string;
  announcementBody?: string;
  /** 个人 API 网关（OpenAI 兼容端点上游）。 */
  gatewayEnabled: boolean;
  gatewayBaseUrl?: string;
  gatewayApiKey?: string;
  /** 逗号分隔的模型 ID 列表（透传给 /v1/models）。 */
  gatewayModels?: string;
}

export interface PlatformPrompt {
  id: string;
  ownerId?: string;
  ownerUsername?: string;
  title: string;
  content: string;
  /** 斜杠命令（可选，/xxx 触发聊天输入展开；OpenWebUI prompt.command 对应）。 */
  command?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlatformKbDoc {
  id: string;
  title: string;
  filename?: string;
  size: number;
  chunkCount: number;
  createdAt: number;
  ownerId?: string;
  ownerUsername?: string;
}

export interface PlatformKbHit {
  docId: string;
  docTitle: string;
  snippet: string;
}

export interface PlatformEvent {
  id: number;
  type: string;
  userId?: string;
  username?: string;
  detail?: string;
  createdAt: number;
}

export interface PlatformStats {
  users: number;
  pendingUsers: number;
  activeSessions: number;
  shares: number;
  prompts: number;
  kbDocs: number;
  logins24h: number;
  searches24h: number;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
  status: string;
  created_at: number;
  last_login_at: number | null;
  password_hash: string;
  salt: string;
  email?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 6;
const USERNAME_PATTERN = /^[\w.-]{2,32}$/;

/**
 * 默认权限（OpenWebUI DEFAULT_USER_PERMISSIONS 的精简移植，点分键）。
 * 组权限按 key 覆盖：任一用户所在组为 true 即放行；无组命中时回退本默认值。
 */
export const DEFAULT_USER_PERMISSIONS: Record<string, boolean> = {
  "chat.share": true,
  "chat.export": true,
  "sharing.public": true,
  "workspace.prompts": true,
  "features.web_search": true,
};

export class PlatformStore {
  readonly #db: InstanceType<typeof DatabaseSync>;
  readonly #filePath: string;
  #ftsEnabled = false;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#filePath = join(dataDir, "users.db");
    this.#db = new DatabaseSync(this.#filePath);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        last_login_at INTEGER,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        permissions TEXT NOT NULL DEFAULT '{}',
        created_by TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS invites (
        code TEXT PRIMARY KEY,
        created_by TEXT,
        max_uses INTEGER NOT NULL DEFAULT 0,
        used_count INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER,
        default_role TEXT,
        note TEXT,
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shares (
        token TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        title TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'public',
        owner_id TEXT NOT NULL,
        snapshot TEXT NOT NULL,
        view_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shares_resource ON shares (resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id);
      CREATE TABLE IF NOT EXISTS prompts (
        id TEXT PRIMARY KEY,
        owner_id TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_prompts_owner ON prompts (owner_id);
      CREATE TABLE IF NOT EXISTS kb_docs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        filename TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        owner_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kb_chunks (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        content TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks (doc_id);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        user_id TEXT,
        username TEXT,
        detail TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_time ON events (created_at DESC);
      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens (user_id);
    `);
    // FTS5 全文索引（Node 24 内置 SQLite 通常启用；不可用时回退 LIKE 检索）。
    try {
      this.#db.exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(content, doc_id UNINDEXED);",
      );
      this.#ftsEnabled = true;
    } catch {
      this.#ftsEnabled = false;
    }
    // 用户表资料列迁移（OpenWebUI Account 页对应字段；旧库幂等补列）。
    for (const column of ["email TEXT", "bio TEXT", "avatar_url TEXT"]) {
      try {
        this.#db.exec(`ALTER TABLE users ADD COLUMN ${column};`);
      } catch {
        // 列已存在时忽略（SQLite ALTER 无 IF NOT EXISTS）。
      }
    }
    // 提示词斜杠命令列（OpenWebUI prompt.command 对应）。
    try {
      this.#db.exec("ALTER TABLE prompts ADD COLUMN command TEXT;");
    } catch {
      // 列已存在时忽略。
    }
  }

  get filePath(): string {
    return this.#filePath;
  }

  get needsSetup(): boolean {
    const row = this.#db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    return Number(row.n) === 0;
  }

  // ================= 系统配置（env 默认 + DB 覆盖，OpenWebUI AdminConfig 模式） =================

  #configCache?: PlatformConfig;

  getConfig(): PlatformConfig {
    if (this.#configCache) return this.#configCache;
    const read = (key: string): string | undefined => {
      const row = this.#db.prepare("SELECT value FROM config WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
      return row?.value;
    };
    this.#configCache = {
      enableSignup: (read("enableSignup") ?? "true") === "true",
      requireInvite: (read("requireInvite") ?? "false") === "true",
      defaultRole: read("defaultRole") === "pending" ? "pending" : "user",
      ...(read("loginNotice") ? { loginNotice: read("loginNotice") } : {}),
      pendingNotice:
        read("pendingNotice") ?? "账号已创建，等待管理员审批后即可使用。如急用请联系管理员。",
      announcementEnabled: (read("announcementEnabled") ?? "false") === "true",
      ...(read("announcementTitle") ? { announcementTitle: read("announcementTitle") } : {}),
      ...(read("announcementBody") ? { announcementBody: read("announcementBody") } : {}),
      gatewayEnabled: (read("gatewayEnabled") ?? "false") === "true",
      ...(read("gatewayBaseUrl") ? { gatewayBaseUrl: read("gatewayBaseUrl") } : {}),
      ...(read("gatewayApiKey") ? { gatewayApiKey: read("gatewayApiKey") } : {}),
      ...(read("gatewayModels") ? { gatewayModels: read("gatewayModels") } : {}),
    };
    return this.#configCache;
  }

  updateConfig(patch: Partial<PlatformConfig>): PlatformConfig {
    const set = (key: string, value: string | undefined): void => {
      if (value === undefined) return;
      this.#db
        .prepare(
          "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(key, value);
    };
    if (patch.enableSignup !== undefined) set("enableSignup", String(patch.enableSignup));
    if (patch.requireInvite !== undefined) set("requireInvite", String(patch.requireInvite));
    if (patch.defaultRole !== undefined) set("defaultRole", patch.defaultRole);
    if (patch.pendingNotice !== undefined) set("pendingNotice", patch.pendingNotice);
    if (patch.loginNotice !== undefined) set("loginNotice", patch.loginNotice);
    if (patch.announcementEnabled !== undefined)
      set("announcementEnabled", String(patch.announcementEnabled));
    if (patch.announcementTitle !== undefined) set("announcementTitle", patch.announcementTitle);
    if (patch.announcementBody !== undefined) set("announcementBody", patch.announcementBody);
    if (patch.gatewayEnabled !== undefined) set("gatewayEnabled", String(patch.gatewayEnabled));
    if (patch.gatewayBaseUrl !== undefined) set("gatewayBaseUrl", patch.gatewayBaseUrl.trim());
    if (patch.gatewayApiKey !== undefined) set("gatewayApiKey", patch.gatewayApiKey.trim());
    if (patch.gatewayModels !== undefined) set("gatewayModels", patch.gatewayModels.trim());
    this.#configCache = undefined;
    return this.getConfig();
  }

  // ================= 用户 =================

  #hashPassword(password: string, salt: string): string {
    return scryptSync(password, salt, 64).toString("hex");
  }

  createUser(input: {
    username: string;
    password: string;
    displayName?: string;
    role?: PlatformUserRole;
  }): PlatformUser {
    const username = input.username.trim();
    if (!USERNAME_PATTERN.test(username)) {
      throw new Error("用户名需为 2-32 位字母/数字/._- 组合");
    }
    if (typeof input.password !== "string" || input.password.length < PASSWORD_MIN_LENGTH) {
      throw new Error(`密码长度至少 ${PASSWORD_MIN_LENGTH} 位`);
    }
    const role = input.role ?? this.getConfig().defaultRole;
    const salt = randomBytes(16).toString("hex");
    const passwordHash = this.#hashPassword(input.password, salt);
    const id = `u_${randomBytes(9).toString("hex")}`;
    const now = Date.now();
    try {
      this.#db
        .prepare(
          "INSERT INTO users (id, username, display_name, role, status, created_at, password_hash, salt) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
        )
        .run(id, username, input.displayName?.trim() || null, role, now, passwordHash, salt);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new Error(`用户名已存在: ${username}`);
      }
      throw error;
    }
    return this.getUser(id)!;
  }

  getUser(id: string): PlatformUser | undefined {
    const row = this.#db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | UserRow
      | undefined;
    return row ? this.#rowToUser(row) : undefined;
  }

  getUserByUsername(username: string): PlatformUser | undefined {
    const row = this.#db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
      | UserRow
      | undefined;
    return row ? this.#rowToUser(row) : undefined;
  }

  listUsers(): PlatformUser[] {
    const rows = this.#db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as unknown as UserRow[];
    return rows.map((row) => this.#rowToUser(row));
  }

  setUserStatus(id: string, status: PlatformUserStatus): PlatformUser | undefined {
    this.#db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, id);
    if (status === "disabled") this.deleteSessionsForUser(id);
    return this.getUser(id);
  }

  setUserRole(id: string, role: PlatformUserRole): PlatformUser | undefined {
    this.#db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
    // 审批通过 / 降级后同步清理会话，让角色变更即时生效。
    this.deleteSessionsForUser(id);
    return this.getUser(id);
  }

  /**
   * 更新个人资料（OpenWebUI POST /auths/update/profile 对应）。
   * 头像仅接受 data:image/(png|jpeg|gif|webp);base64 格式（SVG 拒绝防脚本注入，
   * 对齐 OpenWebUI validate_image_url 白名单语义），上限 512KB。
   */
  updateProfile(
    id: string,
    patch: {
      displayName?: string;
      email?: string | null;
      bio?: string | null;
      avatarUrl?: string | null;
    },
  ): PlatformUser | undefined {
    const existing = this.getUser(id);
    if (!existing) return undefined;
    const avatar = patch.avatarUrl !== undefined ? patch.avatarUrl : undefined;
    if (avatar) {
      if (avatar.length > 512 * 1024) {
        throw new Error("头像过大（上限 512KB），请压缩后重试");
      }
      if (!/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)) {
        throw new Error("头像格式不支持：仅接受 png/jpeg/gif/webp data-URI");
      }
    }
    if (patch.email !== undefined && patch.email && patch.email.trim()) {
      const email = patch.email.trim();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("邮箱格式不正确");
      }
      const taken = this.#db
        .prepare("SELECT id FROM users WHERE email = ? AND id != ?")
        .get(email, id);
      if (taken) throw new Error("邮箱已被其他账号使用");
    }
    this.#db
      .prepare(
        `UPDATE users SET
           display_name = ?,
           email = ?,
           bio = ?,
           avatar_url = ?
         WHERE id = ?`,
      )
      .run(
        // undefined = 不变；显式空串/null = 清除（账号页“移除头像”依赖此语义）。
        patch.displayName !== undefined
          ? (patch.displayName?.trim() || null)
          : (existing.displayName ?? null),
        patch.email !== undefined ? (patch.email?.trim() || null) : (existing.email ?? null),
        patch.bio !== undefined ? (patch.bio?.trim() || null) : (existing.bio ?? null),
        patch.avatarUrl !== undefined ? (patch.avatarUrl || null) : (existing.avatarUrl ?? null),
        id,
      );
    return this.getUser(id);
  }

  /** 读取头像 data-URI（/avatar 端点用）；未设置返回 undefined。 */
  getAvatarUrl(id: string): string | undefined {
    const row = this.#db.prepare("SELECT avatar_url FROM users WHERE id = ?").get(id) as
      | { avatar_url: string | null }
      | undefined;
    return row?.avatar_url ?? undefined;
  }

  resetPassword(id: string, newPassword: string): void {
    if (typeof newPassword !== "string" || newPassword.length < PASSWORD_MIN_LENGTH) {
      throw new Error(`密码长度至少 ${PASSWORD_MIN_LENGTH} 位`);
    }
    const salt = randomBytes(16).toString("hex");
    const passwordHash = this.#hashPassword(newPassword, salt);
    this.#db
      .prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?")
      .run(passwordHash, salt, id);
    this.deleteSessionsForUser(id);
  }

  changePassword(id: string, currentPassword: string, newPassword: string): void {
    const row = this.#db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | UserRow
      | undefined;
    if (!row) throw new Error("用户不存在");
    const expected = Buffer.from(row.password_hash, "hex");
    const actual = scryptSync(currentPassword, row.salt, 64);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error("当前密码不正确");
    }
    this.resetPassword(id, newPassword);
  }

  deleteUser(id: string): boolean {
    const adminCount = (
      this.#db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as {
        n: number;
      }
    ).n;
    const target = this.getUser(id);
    if (target?.role === "admin" && adminCount <= 1) {
      throw new Error("不能删除最后一个管理员");
    }
    this.deleteSessionsForUser(id);
    this.#db.prepare("DELETE FROM group_members WHERE user_id = ?").run(id);
    this.#db.prepare("DELETE FROM shares WHERE owner_id = ?").run(id);
    const result = this.#db.prepare("DELETE FROM users WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  /** 校验用户名+口令；成功时刷新 last_login_at 并返回用户。 */
  verifyLogin(username: string, password: string): PlatformUser | undefined {
    const row = this.#db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
      | UserRow
      | undefined;
    if (!row) return undefined;
    const expected = Buffer.from(row.password_hash, "hex");
    const actual = scryptSync(password, row.salt, 64);
    const ok =
      expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!ok) return undefined;
    if (row.status !== "active") throw new Error("账号已被禁用");
    this.#db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(Date.now(), row.id);
    return this.getUser(row.id);
  }

  // ================= 会话 =================

  createSession(userId: string): PlatformSession {
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;
    this.#db
      .prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(token, userId, now, expiresAt);
    return { token, userId, expiresAt };
  }

  getSession(token: string | undefined): { user: PlatformUser; session: PlatformSession } | undefined {
    if (!token) return undefined;
    const session = this.#db.prepare("SELECT * FROM sessions WHERE token = ?").get(token) as
      | { token: string; user_id: string; created_at: number; expires_at: number }
      | undefined;
    if (!session) return undefined;
    if (session.expires_at <= Date.now()) {
      this.#db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
      return undefined;
    }
    const user = this.getUser(session.user_id);
    if (!user || user.status !== "active") return undefined;
    return {
      user,
      session: { token: session.token, userId: session.user_id, expiresAt: session.expires_at },
    };
  }

  deleteSession(token: string): void {
    this.#db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }

  deleteSessionsForUser(userId: string): void {
    this.#db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  purgeExpiredSessions(): void {
    this.#db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  }

  // ================= 用户组（OpenWebUI Groups 移植） =================

  createGroup(input: {
    name: string;
    description?: string;
    permissions?: Record<string, boolean>;
    createdBy?: string;
    memberIds?: string[];
  }): PlatformGroup {
    const name = input.name.trim();
    if (!name || name.length > 64) throw new Error("组名需为 1-64 个字符");
    const id = `g_${randomBytes(6).toString("hex")}`;
    const now = Date.now();
    try {
      this.#db
        .prepare(
          "INSERT INTO groups (id, name, description, permissions, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          name,
          input.description?.trim() || null,
          JSON.stringify(input.permissions ?? {}),
          input.createdBy ?? null,
          now,
        );
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new Error(`组名已存在: ${name}`);
      }
      throw error;
    }
    for (const userId of input.memberIds ?? []) {
      if (this.getUser(userId)) this.#addGroupMemberRow(id, userId);
    }
    return this.getGroup(id)!;
  }

  #addGroupMemberRow(groupId: string, userId: string): void {
    this.#db
      .prepare(
        "INSERT OR IGNORE INTO group_members (group_id, user_id, created_at) VALUES (?, ?, ?)",
      )
      .run(groupId, userId, Date.now());
  }

  getGroup(id: string): PlatformGroup | undefined {
    const row = this.#db.prepare("SELECT * FROM groups WHERE id = ?").get(id) as
      | { id: string; name: string; description: string | null; permissions: string; created_by: string | null; created_at: number }
      | undefined;
    if (!row) return undefined;
    const memberCount = (
      this.#db.prepare("SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?").get(id) as {
        n: number;
      }
    ).n;
    return {
      id: row.id,
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      permissions: this.#safeJson(row.permissions, {}),
      ...(row.created_by ? { createdBy: row.created_by } : {}),
      createdAt: Number(row.created_at),
      memberCount: Number(memberCount),
    };
  }

  listGroups(options?: { userId?: string; withMembers?: boolean }): PlatformGroup[] {
    const rows = (
      options?.userId
        ? this.#db
            .prepare(
              "SELECT g.* FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ? ORDER BY g.created_at ASC",
            )
            .all(options.userId)
        : this.#db.prepare("SELECT * FROM groups ORDER BY created_at ASC").all()
    ) as Array<{
      id: string;
      name: string;
      description: string | null;
      permissions: string;
      created_by: string | null;
      created_at: number;
    }>;
    return rows.map((row) => {
      const base = this.getGroup(row.id)!;
      if (options?.withMembers) {
        const memberRows = this.#db
          .prepare("SELECT user_id FROM group_members WHERE group_id = ?")
          .all(row.id) as Array<{ user_id: string }>;
        return { ...base, memberIds: memberRows.map((m) => m.user_id) };
      }
      return base;
    });
  }

  updateGroup(
    id: string,
    patch: { name?: string; description?: string; permissions?: Record<string, boolean> },
  ): PlatformGroup | undefined {
    const existing = this.getGroup(id);
    if (!existing) return undefined;
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name || name.length > 64) throw new Error("组名需为 1-64 个字符");
      this.#db.prepare("UPDATE groups SET name = ? WHERE id = ?").run(name, id);
    }
    if (patch.description !== undefined) {
      this.#db
        .prepare("UPDATE groups SET description = ? WHERE id = ?")
        .run(patch.description.trim() || null, id);
    }
    if (patch.permissions !== undefined) {
      this.#db
        .prepare("UPDATE groups SET permissions = ? WHERE id = ?")
        .run(JSON.stringify(patch.permissions), id);
    }
    return this.getGroup(id);
  }

  deleteGroup(id: string): boolean {
    const result = this.#db.prepare("DELETE FROM groups WHERE id = ?").run(id);
    this.#db.prepare("DELETE FROM group_members WHERE group_id = ?").run(id);
    return Number(result.changes) > 0;
  }

  addGroupMembers(id: string, userIds: string[]): number {
    let added = 0;
    for (const userId of userIds) {
      if (!this.getUser(userId)) continue;
      const before = (
        this.#db
          .prepare("SELECT COUNT(*) AS n FROM group_members WHERE group_id = ? AND user_id = ?")
          .get(id, userId) as { n: number }
      ).n;
      if (before === 0) {
        this.#addGroupMemberRow(id, userId);
        added += 1;
      }
    }
    return added;
  }

  removeGroupMembers(id: string, userIds: string[]): number {
    let removed = 0;
    for (const userId of userIds) {
      const result = this.#db
        .prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?")
        .run(id, userId);
      removed += Number(result.changes);
    }
    return removed;
  }

  getGroupIdsForUser(userId: string): string[] {
    return (
      this.#db.prepare("SELECT group_id FROM group_members WHERE user_id = ?").all(userId) as Array<{
        group_id: string;
      }>
    ).map((r) => r.group_id);
  }

  /** 点分键权限判定（OpenWebUI has_permission 语义）：admin 直通；任一组 true 即放行；否则默认值。 */
  hasPermission(user: PlatformUser, key: string): boolean {
    if (user.role === "admin") return true;
    const groups = this.listGroups({ userId: user.id });
    for (const group of groups) {
      const value = group.permissions[key];
      if (value === true) return true;
    }
    return DEFAULT_USER_PERMISSIONS[key] ?? false;
  }

  // ================= 邀请码（自建能力，OpenWebUI 无此机制） =================

  createInvite(input: {
    createdBy?: string;
    maxUses?: number;
    expiresInDays?: number;
    defaultRole?: "user" | "pending";
    note?: string;
  }): PlatformInvite {
    const code = randomBytes(5).toString("hex"); // 10 位安全邀请码
    const now = Date.now();
    const maxUses = Math.max(0, Math.floor(input.maxUses ?? 0));
    const expiresAt =
      input.expiresInDays && input.expiresInDays > 0 ? now + input.expiresInDays * 86_400_000 : null;
    this.#db
      .prepare(
        "INSERT INTO invites (code, created_by, max_uses, used_count, expires_at, default_role, note, disabled, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, 0, ?)",
      )
      .run(
        code,
        input.createdBy ?? null,
        maxUses,
        expiresAt,
        input.defaultRole ?? null,
        input.note?.trim() || null,
        now,
      );
    return this.getInvite(code)!;
  }

  getInvite(code: string): PlatformInvite | undefined {
    const row = this.#db.prepare("SELECT * FROM invites WHERE code = ?").get(code) as
      | {
          code: string;
          created_by: string | null;
          max_uses: number;
          used_count: number;
          expires_at: number | null;
          default_role: string | null;
          note: string | null;
          disabled: number;
          created_at: number;
        }
      | undefined;
    if (!row) return undefined;
    return {
      code: row.code,
      ...(row.created_by ? { createdBy: row.created_by } : {}),
      maxUses: Number(row.max_uses),
      usedCount: Number(row.used_count),
      ...(row.expires_at ? { expiresAt: Number(row.expires_at) } : {}),
      ...(row.default_role === "user" || row.default_role === "pending"
        ? { defaultRole: row.default_role }
        : {}),
      ...(row.note ? { note: row.note } : {}),
      disabled: Number(row.disabled) === 1,
      createdAt: Number(row.created_at),
    };
  }

  listInvites(): PlatformInvite[] {
    return (
      this.#db.prepare("SELECT code FROM invites ORDER BY created_at DESC").all() as Array<{
        code: string;
      }>
    )
      .map((r) => this.getInvite(r.code))
      .filter((v): v is PlatformInvite => Boolean(v));
  }

  /** 校验邀请码是否可用（供注册页预检）。 */
  validateInvite(code: string): { valid: boolean; reason?: string; invite?: PlatformInvite } {
    const invite = this.getInvite(code);
    if (!invite) return { valid: false, reason: "邀请码不存在" };
    if (invite.disabled) return { valid: false, reason: "邀请码已被停用" };
    if (invite.expiresAt && invite.expiresAt <= Date.now())
      return { valid: false, reason: "邀请码已过期" };
    if (invite.maxUses > 0 && invite.usedCount >= invite.maxUses)
      return { valid: false, reason: "邀请码使用次数已达上限" };
    return { valid: true, invite };
  }

  /** 消耗一次邀请码使用次数（注册成功后调用）。 */
  consumeInvite(code: string): void {
    this.#db
      .prepare("UPDATE invites SET used_count = used_count + 1 WHERE code = ?")
      .run(code);
  }

  setInviteDisabled(code: string, disabled: boolean): PlatformInvite | undefined {
    this.#db.prepare("UPDATE invites SET disabled = ? WHERE code = ?").run(disabled ? 1 : 0, code);
    return this.getInvite(code);
  }

  deleteInvite(code: string): boolean {
    const result = this.#db.prepare("DELETE FROM invites WHERE code = ?").run(code);
    return Number(result.changes) > 0;
  }

  // ================= 分享（对话/任务/项目快照，OpenWebUI shared_chats 模式） =================

  createShare(input: {
    resourceType: ShareResourceType;
    resourceId: string;
    title: string;
    visibility: ShareVisibility;
    ownerId: string;
    snapshot: unknown;
  }): PlatformShare {
    const token = randomBytes(6).toString("base64url");
    const now = Date.now();
    this.#db
      .prepare(
        "INSERT INTO shares (token, resource_type, resource_id, title, visibility, owner_id, snapshot, view_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
      )
      .run(
        token,
        input.resourceType,
        input.resourceId,
        input.title.slice(0, 300),
        input.visibility,
        input.ownerId,
        JSON.stringify(input.snapshot).slice(0, 4 * 1024 * 1024),
        now,
        now,
      );
    return this.getShare(token)!;
  }

  getShare(token: string, options?: { withSnapshot?: boolean }): PlatformShare | undefined {
    const row = this.#db.prepare("SELECT * FROM shares WHERE token = ?").get(token) as
      | {
          token: string;
          resource_type: string;
          resource_id: string;
          title: string;
          visibility: string;
          owner_id: string;
          snapshot: string;
          view_count: number;
          created_at: number;
          updated_at: number;
        }
      | undefined;
    if (!row) return undefined;
    const owner = this.getUser(row.owner_id);
    const base: PlatformShare = {
      token: row.token,
      resourceType: row.resource_type as ShareResourceType,
      resourceId: row.resource_id,
      title: row.title,
      visibility: row.visibility === "open" ? "open" : "public",
      ownerId: row.owner_id,
      ...(owner ? { ownerUsername: owner.username } : {}),
      snapshot: options?.withSnapshot ? this.#safeJson(row.snapshot, null) : null,
      viewCount: Number(row.view_count),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
    return base;
  }

  listShares(options?: { ownerId?: string }): Omit<PlatformShare, "snapshot">[] {
    const rows = (
      options?.ownerId
        ? this.#db.prepare("SELECT token FROM shares WHERE owner_id = ? ORDER BY created_at DESC").all(options.ownerId)
        : this.#db.prepare("SELECT token FROM shares ORDER BY created_at DESC").all()
    ) as Array<{ token: string }>;
    return rows
      .map((r) => this.getShare(r.token))
      .filter((v): v is PlatformShare => Boolean(v))
      .map(({ snapshot: _snapshot, ...rest }) => rest);
  }

  updateShareVisibility(token: string, visibility: ShareVisibility): PlatformShare | undefined {
    this.#db
      .prepare("UPDATE shares SET visibility = ?, updated_at = ? WHERE token = ?")
      .run(visibility, Date.now(), token);
    return this.getShare(token);
  }

  /** 分享内容更新（重新快照）。 */
  updateShareSnapshot(token: string, snapshot: unknown, title?: string): PlatformShare | undefined {
    this.#db
      .prepare("UPDATE shares SET snapshot = ?, updated_at = ? WHERE token = ?")
      .run(JSON.stringify(snapshot).slice(0, 4 * 1024 * 1024), Date.now(), token);
    if (title) {
      this.#db
        .prepare("UPDATE shares SET title = ? WHERE token = ?")
        .run(title.slice(0, 300), token);
    }
    return this.getShare(token);
  }

  deleteShare(token: string): boolean {
    const result = this.#db.prepare("DELETE FROM shares WHERE token = ?").run(token);
    return Number(result.changes) > 0;
  }

  incrementShareViewCount(token: string): void {
    this.#db
      .prepare("UPDATE shares SET view_count = view_count + 1 WHERE token = ?")
      .run(token);
  }

  // ================= 提示词库（个人 + 全局，OpenWebUI Prompts 同位功能） =================

  listPrompts(viewer: PlatformUser): PlatformPrompt[] {
    const rows = (
      this.#db
        .prepare(
          "SELECT p.*, u.username AS owner_username FROM prompts p LEFT JOIN users u ON u.id = p.owner_id WHERE p.owner_id IS NULL OR p.owner_id = ? ORDER BY p.updated_at DESC",
        )
        .all(viewer.id) as Array<{
        id: string;
        owner_id: string | null;
        owner_username: string | null;
        title: string;
        content: string;
        created_at: number;
        updated_at: number;
        command?: string | null;
      }>
    ).map((row) => ({
      id: row.id,
      ...(row.owner_id ? { ownerId: row.owner_id } : {}),
      ...(row.owner_username ? { ownerUsername: row.owner_username } : {}),
      title: row.title,
      content: row.content,
      ...(row.command ? { command: row.command } : {}),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
    return rows;
  }

  createPrompt(input: {
    ownerId?: string;
    title: string;
    content: string;
    command?: string;
  }): PlatformPrompt {
    const command = normalizePromptCommand(input.command);
    if (command && this.#promptCommandTaken(command, input.ownerId ?? null)) {
      throw new Error(`斜杠命令 /${command} 已被占用`);
    }
    const id = `p_${randomBytes(9).toString("hex")}`;
    const now = Date.now();
    this.#db
      .prepare(
        "INSERT INTO prompts (id, owner_id, title, content, command, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, input.ownerId ?? null, input.title, input.content, command ?? null, now, now);
    return this.#getPromptOrThrow(id);
  }

  #promptCommandTaken(command: string, ownerId: string | null): boolean {
    // 命令在"对当前用户可见集合"内唯一：全局 + 本人；避免同名冲突。
    const row = this.#db
      .prepare(
        "SELECT id FROM prompts WHERE command = ? AND (owner_id IS NULL OR owner_id = ?) LIMIT 1",
      )
      .get(command, ownerId) as { id: string } | undefined;
    return Boolean(row);
  }

  updatePrompt(
    id: string,
    viewer: PlatformUser,
    patch: { title?: string; content?: string; command?: string },
  ): PlatformPrompt {
    const existing = this.#db.prepare("SELECT * FROM prompts WHERE id = ?").get(id) as
      | { id: string; owner_id: string | null }
      | undefined;
    if (!existing) throw new Error("提示词不存在");
    if (existing.owner_id && existing.owner_id !== viewer.id && viewer.role !== "admin") {
      throw new Error("无权修改他人的提示词");
    }
    const command =
      patch.command !== undefined ? normalizePromptCommand(patch.command) : undefined;
    if (command) {
      const taken = this.#db
        .prepare(
          "SELECT id FROM prompts WHERE command = ? AND (owner_id IS NULL OR owner_id = ?) AND id != ? LIMIT 1",
        )
        .get(command, existing.owner_id, id) as { id: string } | undefined;
      if (taken) throw new Error(`斜杠命令 /${command} 已被占用`);
    }
    this.#db
      .prepare(
        "UPDATE prompts SET title = ?, content = ?, command = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        patch.title ?? this.#getPromptTitle(id),
        patch.content ?? this.#getPromptContent(id),
        command !== undefined ? (command || null) : (existing as { command?: string | null }).command ?? null,
        Date.now(),
        id,
      );
    return this.#getPromptOrThrow(id);
  }

  deletePrompt(id: string, viewer: PlatformUser): void {
    const existing = this.#db.prepare("SELECT owner_id FROM prompts WHERE id = ?").get(id) as
      | { owner_id: string | null }
      | undefined;
    if (!existing) return;
    if (existing.owner_id && existing.owner_id !== viewer.id && viewer.role !== "admin") {
      throw new Error("无权删除他人的提示词");
    }
    this.#db.prepare("DELETE FROM prompts WHERE id = ?").run(id);
  }

  #getPromptTitle(id: string): string {
    const row = this.#db.prepare("SELECT title FROM prompts WHERE id = ?").get(id) as
      | { title: string }
      | undefined;
    return row?.title ?? "";
  }

  #getPromptContent(id: string): string {
    const row = this.#db.prepare("SELECT content FROM prompts WHERE id = ?").get(id) as
      | { content: string }
      | undefined;
    return row?.content ?? "";
  }

  #getPromptOrThrow(id: string): PlatformPrompt {
    const row = this.#db
      .prepare(
        "SELECT p.*, u.username AS owner_username FROM prompts p LEFT JOIN users u ON u.id = p.owner_id WHERE p.id = ?",
      )
      .get(id) as
      | {
          id: string;
          owner_id: string | null;
          owner_username: string | null;
          title: string;
          content: string;
          created_at: number;
          updated_at: number;
        }
      | undefined;
    if (!row) throw new Error("提示词不存在");
    return {
      id: row.id,
      ...(row.owner_id ? { ownerId: row.owner_id } : {}),
      ...(row.owner_username ? { ownerUsername: row.owner_username } : {}),
      title: row.title,
      content: row.content,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  // ================= 知识库（管理员维护，agent 经 MCP 检索） =================

  createKbDoc(input: {
    title: string;
    filename?: string;
    content: string;
    ownerId?: string;
  }): PlatformKbDoc {
    const chunks = chunkDocument(input.content);
    if (chunks.length === 0) throw new Error("文档内容为空");
    const id = `kb_${randomBytes(9).toString("hex")}`;
    const now = Date.now();
    const insertDoc = this.#db.prepare(
      "INSERT INTO kb_docs (id, title, filename, size, chunk_count, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const insertChunk = this.#db.prepare(
      "INSERT INTO kb_chunks (id, doc_id, ord, content) VALUES (?, ?, ?, ?)",
    );
    const insertFts = this.#ftsEnabled
      ? this.#db.prepare("INSERT INTO kb_fts (content, doc_id) VALUES (?, ?)")
      : null;
    // node:sqlite（Node 24）无 transaction() 助手，用手动 BEGIN/COMMIT/ROLLBACK。
    this.#db.exec("BEGIN");
    try {
      insertDoc.run(
        id,
        input.title,
        input.filename ?? null,
        input.content.length,
        chunks.length,
        input.ownerId ?? null,
        now,
      );
      chunks.forEach((content, index) => {
        const chunkId = `kbc_${randomBytes(8).toString("hex")}`;
        insertChunk.run(chunkId, id, index, content);
        insertFts?.run(content, id);
      });
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return this.#getKbDocOrThrow(id);
  }

  /** 知识库列表（用户级隔离：普通用户仅自己创建的，admin 全部可见）。 */
  listKbDocs(options?: { ownerId?: string }): PlatformKbDoc[] {
    const scoped = Boolean(options?.ownerId);
    const rows = (
      this.#db
        .prepare(
          `SELECT d.*, u.username AS owner_username FROM kb_docs d
           LEFT JOIN users u ON u.id = d.owner_id
           ${scoped ? "WHERE d.owner_id = ?" : ""}
           ORDER BY d.created_at DESC`,
        )
        .all(...(scoped ? [options!.ownerId!] : [])) as Array<{
        id: string;
        title: string;
        filename: string | null;
        size: number;
        chunk_count: number;
        owner_id: string | null;
        owner_username: string | null;
        created_at: number;
      }>
    ).map((row) => ({
      id: row.id,
      title: row.title,
      ...(row.filename ? { filename: row.filename } : {}),
      size: Number(row.size),
      chunkCount: Number(row.chunk_count),
      createdAt: Number(row.created_at),
      ...(row.owner_id ? { ownerId: row.owner_id } : {}),
      ...(row.owner_username ? { ownerUsername: row.owner_username } : {}),
    }));
    return rows;
  }

  getKbDocOwner(id: string): string | undefined {
    const row = this.#db.prepare("SELECT owner_id FROM kb_docs WHERE id = ?").get(id) as
      | { owner_id: string | null }
      | undefined;
    return row?.owner_id ?? undefined;
  }

  deleteKbDoc(id: string): void {
    this.#db.exec("BEGIN");
    try {
      if (this.#ftsEnabled) {
        this.#db.prepare("DELETE FROM kb_fts WHERE doc_id = ?").run(id);
      }
      this.#db.prepare("DELETE FROM kb_chunks WHERE doc_id = ?").run(id);
      this.#db.prepare("DELETE FROM kb_docs WHERE id = ?").run(id);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  searchKb(query: string, limit = 6, options?: { ownerId?: string }): PlatformKbHit[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    // 用户级隔离：普通用户只能检索自己创建的文档（OpenWebUI knowledge 语义）。
    const scopeJoin = options?.ownerId ? "AND d.owner_id = ?" : "";
    const scopeParams = options?.ownerId ? [options.ownerId] : [];
    if (this.#ftsEnabled) {
      // FTS5 MATCH：把查询词按空白拆分后做 AND 组合，避免原始语法报错。
      // 注意 unicode61 分词器对连续 CJK 文本切分粒度很粗，中文短词常命中 0 行，
      // 因此 FTS 无命中时必须继续走 LIKE 兜底，而不是直接返回空。
      const matchQuery = trimmed
        .split(/\s+/)
        .map((token) => `"${token.replace(/"/g, "")}"`)
        .join(" AND ");
      try {
        const rows = this.#db
          .prepare(
            "SELECT d.id AS doc_id, d.title AS doc_title, snippet(kb_fts, 0, '…', '…', '…', 12) AS snip FROM kb_fts JOIN kb_docs d ON d.id = kb_fts.doc_id WHERE kb_fts MATCH ? ${scopeJoin} LIMIT ?",
          )
          .all(matchQuery, ...scopeParams, limit) as Array<{
          doc_id: string;
          doc_title: string;
          snip: string;
        }>;
        if (rows.length > 0) {
          return rows.map((row) => ({ docId: row.doc_id, docTitle: row.doc_title, snippet: row.snip }));
        }
      } catch {
        // MATCH 语法不兼容时回退 LIKE。
      }
    }
    const like = `%${trimmed.replace(/[%_]/g, " ")}%`;
    const rows = this.#db
      .prepare(
        `SELECT DISTINCT d.id AS doc_id, d.title AS doc_title, c.content AS content
         FROM kb_chunks c JOIN kb_docs d ON d.id = c.doc_id
         WHERE c.content LIKE ? ${scopeJoin} LIMIT ?`,
      )
      .all(like, ...scopeParams, limit) as Array<{ doc_id: string; doc_title: string; content: string }>;
    return rows.map((row) => ({
      docId: row.doc_id,
      docTitle: row.doc_title,
      snippet: row.content.slice(0, 240),
    }));
  }

  #getKbDocOrThrow(id: string): PlatformKbDoc {
    const row = this.#db.prepare("SELECT * FROM kb_docs WHERE id = ?").get(id) as
      | {
          id: string;
          title: string;
          filename: string | null;
          size: number;
          chunk_count: number;
          created_at: number;
        }
      | undefined;
    if (!row) throw new Error("文档不存在");
    return {
      id: row.id,
      title: row.title,
      ...(row.filename ? { filename: row.filename } : {}),
      size: Number(row.size),
      chunkCount: Number(row.chunk_count),
      createdAt: Number(row.created_at),
    };
  }

  // ================= 个人 API Token（OpenWebUI 式 API keys） =================

  /** 发放个人 API Token。完整明文仅在创建响应中出现一次，库内只存 SHA-256 哈希。 */
  createApiToken(input: { userId: string; name: string }): {
    id: string;
    name: string;
    token: string;
    prefix: string;
    createdAt: number;
  } {
    const name = input.name.trim().slice(0, 64) || "default";
    // 同名活跃令牌去重：改名比堆叠无意义令牌更健康。
    const dup = this.#db
      .prepare("SELECT id FROM api_tokens WHERE user_id = ? AND name = ? AND revoked_at IS NULL")
      .get(input.userId, name) as { id: string } | undefined;
    if (dup) throw new Error("已存在同名令牌，请换一个名称或先吊销旧令牌");
    const secret = randomBytes(24).toString("base64url");
    const token = `sk-zc-${secret}`;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const prefix = `sk-zc-${secret.slice(0, 4)}…${secret.slice(-4)}`;
    const id = `tok_${randomBytes(8).toString("hex")}`;
    const now = Date.now();
    this.#db
      .prepare(
        "INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, input.userId, name, tokenHash, prefix, now);
    return { id, name, token, prefix, createdAt: now };
  }

  listApiTokens(userId: string): Array<{
    id: string;
    name: string;
    prefix: string;
    createdAt: number;
    lastUsedAt?: number;
    revokedAt?: number;
  }> {
    const rows = this.#db
      .prepare(
        "SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC",
      )
      .all(userId) as Array<{
      id: string;
      name: string;
      prefix: string;
      created_at: number;
      last_used_at: number | null;
      revoked_at: number | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      createdAt: Number(row.created_at),
      ...(row.last_used_at ? { lastUsedAt: Number(row.last_used_at) } : {}),
      ...(row.revoked_at ? { revokedAt: Number(row.revoked_at) } : {}),
    }));
  }

  /** 吊销令牌（本人或管理员）。返回是否确有行被更新。 */
  revokeApiToken(id: string, viewer: PlatformUser): boolean {
    const row = this.#db.prepare("SELECT user_id FROM api_tokens WHERE id = ?").get(id) as
      | { user_id: string }
      | undefined;
    if (!row) return false;
    if (row.user_id !== viewer.id && viewer.role !== "admin") {
      throw new Error("无权吊销他人的令牌");
    }
    const result = this.#db
      .prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(Date.now(), id);
    return Number(result.changes) > 0;
  }

  /** 网关鉴权：按明文令牌查活跃项；命中则顺手更新 last_used_at。 */
  verifyApiToken(
    rawToken: string,
  ): { tokenId: string; userId: string } | undefined {
    if (!rawToken.startsWith("sk-zc-")) return undefined;
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const row = this.#db
      .prepare(
        "SELECT id, user_id FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL",
      )
      .get(tokenHash) as { id: string; user_id: string } | undefined;
    if (!row) return undefined;
    try {
      this.#db
        .prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?")
        .run(Date.now(), row.id);
    } catch {
      // 触碰失败不影响请求。
    }
    return { tokenId: row.id, userId: row.user_id };
  }

  // ================= 审计事件与用量统计 =================

  recordEvent(type: string, user?: PlatformUser, detail?: string): void {
    try {
      this.#db
        .prepare("INSERT INTO events (type, user_id, username, detail, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(type, user?.id ?? null, user?.username ?? null, detail ?? null, Date.now());
      // 审计表软上限：保留最近 10000 条，防止无限膨胀。
      this.#db
        .prepare(
          "DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 10000)",
        )
        .run();
    } catch {
      // 审计记录失败不影响主流程。
    }
  }

  listEvents(options: { type?: string; limit?: number }): PlatformEvent[] {
    const limit = Math.min(500, Math.max(1, options.limit ?? 100));
    const rows = (
      options.type
        ? this.#db
            .prepare(
              "SELECT * FROM events WHERE type = ? ORDER BY id DESC LIMIT ?",
            )
            .all(options.type, limit)
        : this.#db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit)
    ) as Array<{
      id: number;
      type: string;
      user_id: string | null;
      username: string | null;
      detail: string | null;
      created_at: number;
    }>;
    return rows.map((row) => ({
      id: Number(row.id),
      type: row.type,
      ...(row.user_id ? { userId: row.user_id } : {}),
      ...(row.username ? { username: row.username } : {}),
      ...(row.detail ? { detail: row.detail } : {}),
      createdAt: Number(row.created_at),
    }));
  }

  getStats(): PlatformStats {
    const count = (sql: string, ...params: Array<string | number>): number => {
      const row = this.#db.prepare(sql).get(...params) as { n: number } | undefined;
      return Number(row?.n ?? 0);
    };
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return {
      users: count("SELECT COUNT(*) AS n FROM users"),
      pendingUsers: count("SELECT COUNT(*) AS n FROM users WHERE role = 'pending'"),
      activeSessions: count("SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?", Date.now()),
      shares: count("SELECT COUNT(*) AS n FROM shares"),
      prompts: count("SELECT COUNT(*) AS n FROM prompts"),
      kbDocs: count("SELECT COUNT(*) AS n FROM kb_docs"),
      logins24h: count("SELECT COUNT(*) AS n FROM events WHERE type = 'auth.login' AND created_at > ?", dayAgo),
      searches24h: count("SELECT COUNT(*) AS n FROM events WHERE type = 'search.query' AND created_at > ?", dayAgo),
    };
  }

  // ================= 内部工具 =================

  #safeJson<T>(text: string, fallback: T): T {
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  }

  close(): void {
    this.#db.close();
  }

  #rowToUser(row: UserRow): PlatformUser {
    return {
      id: row.id,
      username: row.username,
      ...(row.display_name ? { displayName: row.display_name } : {}),
      role: row.role as PlatformUserRole,
      status: row.status as PlatformUserStatus,
      createdAt: Number(row.created_at),
      ...(row.last_login_at ? { lastLoginAt: Number(row.last_login_at) } : {}),
      ...(row.email ? { email: row.email } : {}),
      ...(row.bio ? { bio: row.bio } : {}),
      ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
    };
  }
}

export const PASSWORD_MIN = PASSWORD_MIN_LENGTH;

/** 斜杠命令归一化：去前导 /、小写化、白名单校验；非法输入返回空串（视为未设置）。 */
export function normalizePromptCommand(raw: string | undefined | null): string {
  const value = (raw ?? "").trim().replace(/^\/+/, "").toLowerCase();
  if (!value) return "";
  if (!/^[a-z0-9_-]{1,64}$/.test(value)) return "";
  return value;
}

/**
 * 文档分块：优先按空行分段，超长段落再按固定窗口切分（带少量重叠），
 * 保证每个 chunk 落在 200~800 字符之间，适配 FTS5 关键词检索粒度。
 */
export function chunkDocument(content: string, maxChars = 800): string[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  const pushCurrent = (): void => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };
  for (const paragraph of paragraphs) {
    const piece = paragraph.trim();
    if (!piece) continue;
    if (piece.length > maxChars) {
      pushCurrent();
      const step = Math.max(400, Math.floor(maxChars * 0.8));
      for (let start = 0; start < piece.length; start += step) {
        const window = piece.slice(start, start + maxChars).trim();
        if (window) chunks.push(window);
        if (start + maxChars >= piece.length) break;
      }
      continue;
    }
    if ((current + "\n\n" + piece).trim().length > maxChars) pushCurrent();
    current = current ? `${current}\n\n${piece}` : piece;
  }
  pushCurrent();
  return chunks;
}
