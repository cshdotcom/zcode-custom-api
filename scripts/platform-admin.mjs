#!/usr/bin/env node
/**
 * 平台管理员 CLI 工具（在部署机器上直接运行）：
 *
 *   node scripts/platform-admin.mjs list                              # 列出用户
 *   node scripts/platform-admin.mjs reset-password <username> [newpwd] # 重置密码（省略则生成随机密码）
 *   node scripts/platform-admin.mjs promote <username>                # 提为管理员
 *   node scripts/platform-admin.mjs approve <username>                # 通过 pending 审批
 *   node scripts/platform-admin.mjs disable <username> / enable <username>
 *   node scripts/platform-admin.mjs create <username> <password> [role]
 *
 * 默认数据库路径：~/.zcode/v2/platform/users.db（可用 ZCODE_PLATFORM_DB 环境变量覆盖）。
 * 与 server 共用 scrypt 口令散列；重置后该用户全部会话失效（需重新登录）。
 */
import { randomBytes, scryptSync } from "node:crypto";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const require_ = createRequire(import.meta.url);
const { DatabaseSync } = require_("node:sqlite");

const dbPath =
  process.env.ZCODE_PLATFORM_DB?.trim() ||
  join(homedir(), ".zcode", "v2", "platform", "users.db");

const db = new DatabaseSync(dbPath);

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString("hex");
}

function findUser(username) {
  const row = db.prepare("SELECT id, username, role, status FROM users WHERE username = ?").get(username);
  if (!row) {
    console.error(`用户不存在: ${username}（现有用户: ${db.prepare("SELECT username FROM users").all().map((u) => u.username).join(", ") || "无"}）`);
    process.exit(1);
  }
  return row;
}

function setUserField(username, field, value) {
  const user = findUser(username);
  db.prepare(`UPDATE users SET ${field} = ? WHERE id = ?`).run(value, user.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  console.log(`已更新 ${username}.${field} = ${value}，该用户全部会话已失效（需重新登录）`);
}

const [, , cmd, ...args] = process.argv;
switch (cmd) {
  case "list": {
    const rows = db.prepare("SELECT username, role, status, created_at, last_login_at FROM users ORDER BY created_at").all();
    console.table(
      rows.map((r) => ({
        username: r.username,
        role: r.role,
        status: r.status,
        created: new Date(Number(r.created_at)).toLocaleString(),
        lastLogin: r.last_login_at ? new Date(Number(r.last_login_at)).toLocaleString() : "-",
      })),
    );
    break;
  }
  case "reset-password": {
    const [username, newPwd] = args;
    if (!username) {
      console.error("用法: platform-admin.mjs reset-password <username> [newPassword]");
      process.exit(1);
    }
    const password = newPwd && newPwd.length >= 6 ? newPwd : randomBytes(6).toString("base64url");
    if (password.length < 6) {
      console.error("密码长度至少 6 位");
      process.exit(1);
    }
    const user = findUser(username);
    const salt = randomBytes(16).toString("hex");
    db.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?").run(
      hashPassword(password, salt),
      salt,
      user.id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    console.log(`✔ ${username} 的密码已重置为: ${password}`);
    console.log("  请立即让用户登录并修改密码；该用户全部旧会话已失效。");
    break;
  }
  case "promote":
    setUserField(args[0], "role", "admin");
    break;
  case "approve":
    setUserField(args[0], "role", "user");
    break;
  case "disable":
    setUserField(args[0], "status", "disabled");
    break;
  case "enable":
    setUserField(args[0], "status", "active");
    break;
  case "create": {
    const [username, password, role = "user"] = args;
    if (!username || !password) {
      console.error("用法: platform-admin.mjs create <username> <password> [admin|user]");
      process.exit(1);
    }
    if (!/^[\w.-]{2,32}$/.test(username)) {
      console.error("用户名需为 2-32 位字母/数字/._- 组合");
      process.exit(1);
    }
    if (password.length < 6) {
      console.error("密码长度至少 6 位");
      process.exit(1);
    }
    const salt = randomBytes(16).toString("hex");
    try {
      db.prepare(
        "INSERT INTO users (id, username, role, status, created_at, password_hash, salt) VALUES (?, ?, ?, 'active', ?, ?, ?)",
      ).run(`u_${randomBytes(9).toString("hex")}`, username, role, Date.now(), hashPassword(password, salt), salt);
      console.log(`✔ 用户已创建: ${username}（角色 ${role}）`);
    } catch (error) {
      console.error(error.message.includes("UNIQUE") ? `用户名已存在: ${username}` : error.message);
      process.exit(1);
    }
    break;
  }
  default:
    console.log(
      "用法: node scripts/platform-admin.mjs <command>\n" +
        "  list                                    列出用户\n" +
        "  create <username> <password> [role]     创建用户（role: admin|user）\n" +
        "  reset-password <username> [newpwd]      重置密码（省略则随机生成）\n" +
        "  promote <username>                      提为管理员\n" +
        "  approve <username>                      通过 pending 审批\n" +
        "  disable <username> / enable <username>  停用 / 启用\n" +
        `数据库: ${dbPath}`,
    );
    process.exit(cmd ? 1 : 0);
}
