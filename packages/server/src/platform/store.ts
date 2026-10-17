import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
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
  readonly #db: DatabaseSync;
  readonly #filePath: string;

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
    `);
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
    const rows = this.#db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as UserRow[];
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
    };
  }
}

export const PASSWORD_MIN = PASSWORD_MIN_LENGTH;
