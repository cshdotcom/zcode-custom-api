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
 * 职责：注册 / 登录校验（scrypt 口令散列）/ 会话签发与校验（可吊销）/ 用户管理（角色、启停、重置口令）。
 * 首个注册用户自动成为 admin；此后是否开放注册由注册开关（registrationOpen）控制。
 */

export type PlatformUserRole = "admin" | "user";
export type PlatformUserStatus = "active" | "disabled";

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
    `);
  }

  get filePath(): string {
    return this.#filePath;
  }

  get needsSetup(): boolean {
    const row = this.#db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    return Number(row.n) === 0;
  }

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
    const role = input.role ?? "user";
    const salt = randomBytes(16).toString("hex");
    const passwordHash = this.#hashPassword(input.password, salt);
    const id = `u_${randomBytes(9).toString("hex")}`;
    const now = Date.now();
    try {
      this.#db
        .prepare(
          "INSERT INTO users (id, username, display_name, role, status, created_at, password_hash, salt) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
        )
        .run(
          id,
          username,
          input.displayName?.trim() || null,
          role,
          now,
          passwordHash,
          salt,
        );
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
