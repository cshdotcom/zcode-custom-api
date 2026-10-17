import type { Context, Hono } from "hono";
import { parseCookieHeader } from "./cookies.js";
import type { PlatformStore } from "./store.js";
import { PASSWORD_MIN, type PlatformUser } from "./store.js";
import { SearchService, SEARCH_PROVIDERS } from "./search.js";
import type { RemoteBrowserExecutor } from "@zcode/browser-remote";
import { ZcodeDataSnapshotReader } from "./snapshot.js";
import { shareViewPageHtml } from "./pages.js";

/**
 * 平台路由：自有用户/登录系统（替代官方 z.ai 登录）+ 用户组 + 邀请码 + 系统配置 +
 * 对话/任务/项目分享（快照 + 公开链接）+ 联网搜索服务（多 Provider +
 * OpenWebUI 自定义模式兼容端点）+ 远程浏览器桥状态 + 管理控制台。
 *
 * 鉴权模型：
 * - 平台开启后（ZCODE_PLATFORM_AUTH=1），除 /api/platform/auth/*、/healthz、
 *   公开分享、/search 外，所有 /api、/ws 请求都需要有效会话 Cookie
 *   （zcode_platform_session）。页面请求一律放行到 SPA：登录/注册/审批等待
 *   界面全部由 SPA 内原生渲染（与官方 WebLoginPage 同一设计语言），
 *   不再有服务端 302 到独立手写页面的外挂链路。
 * - pending 角色用户仅能访问认证接口，业务接口一律 403（等待管理员审批）。
 * - 对外搜索端点 /search 用可选 Bearer Token（search.json 的 apiToken）保护，供 OpenWebUI 等外部系统接入。
 * - 内部服务（如搜索 MCP server）用 ZCODE_PLATFORM_SERVICE_TOKEN Bearer Token 访问 /api/platform/search。
 */

export const PLATFORM_SESSION_COOKIE = "zcode_platform_session";

export interface PlatformDeps {
  /** 平台用户存储；未启用平台登录（ZCODE_PLATFORM_AUTH=1）时省略。 */
  store?: PlatformStore;
  search: SearchService;
  browser?: RemoteBrowserExecutor;
  /** ZCode 数据快照读取器（分享功能），平台开启时必传。 */
  snapshot?: ZcodeDataSnapshotReader;
  /** 内部服务 Bearer Token（搜索 MCP server 等）。 */
  serviceToken?: string;
}

function jsonError(c: Context, message: string, status = 400): Response {
  return c.json({ error: message }, status);
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = (await c.req.json()) as unknown;
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function sessionFromRequest(c: Context, store: PlatformStore): PlatformUser | undefined {
  const cookies = parseCookieHeader(c.req.header("cookie"));
  const token = cookies.get(PLATFORM_SESSION_COOKIE);
  return store.getSession(token)?.user;
}

function bearerFromRequest(c: Context): string | undefined {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  const value = header.slice(7).trim();
  return value || undefined;
}

/** 公开路径：分享 token 形如 /s/<token> 或 /api/platform/shares/public/<token>。 */
const SHARE_PAGE_RE = /^\/s\/([A-Za-z0-9_-]+)\/?$/;
const SHARE_PUBLIC_API_RE = /^\/api\/platform\/shares\/public\/([A-Za-z0-9_-]+)\/?$/;
const INVITE_VALIDATE_RE = /^\/api\/platform\/auth\/invite\/([A-Za-z0-9]+)\/?$/;

export function createPlatformAuthMiddleware(deps: PlatformDeps) {
  return async (c: Context, next: () => Promise<void>) => {
    if (!deps.store) {
      await next();
      return;
    }
    const pathname = new URL(c.req.url).pathname;
    const isAuthPath = pathname.startsWith("/api/platform/auth/");
    const isLoginHtml = pathname === "/login" || pathname === "/login/";
    const isHealth = pathname === "/healthz";
    const isPublicShare =
      SHARE_PAGE_RE.test(pathname) ||
      SHARE_PUBLIC_API_RE.test(pathname) ||
      INVITE_VALIDATE_RE.test(pathname);
    // 对外搜索端点（OpenWebUI / MCP server 接入）有独立的 Token 校验，不走平台会话强制鉴权。
    const isPublicSearch = pathname === "/search" || pathname === "/api/platform/search";
    // 内部服务令牌（MCP server 等）可访问知识库检索端点；路由内会再校验令牌本身。
    const isServiceKbSearch =
      pathname === "/api/platform/kb/search" &&
      Boolean(
        deps.serviceToken &&
          bearerFromRequest(c) === deps.serviceToken,
      );
    // 无论是否强制鉴权，都先解析会话（/me、搜索 API、公共端点在已登录时需要 platformUser）。
    const user = sessionFromRequest(c, deps.store);
    if (user) c.set("platformUser", user);
    if (isAuthPath || isLoginHtml || isHealth || isPublicSearch || isPublicShare || isServiceKbSearch) {
      await next();
      return;
    }
    if (user) {
      // pending 用户：业务 API 全部封禁，仅保留认证通道（见 isAuthPath）；
      // 页面请求放行到 SPA，由登录门展示等待审批状态。
      if (user.role === "pending") {
        if (pathname.startsWith("/api/") || pathname.startsWith("/ws")) {
          return jsonError(c, `账号待审批：${deps.store.getConfig().pendingNotice}`, 403);
        }
        await next();
        return;
      }
      await next();
      return;
    }
    if (pathname.startsWith("/api/") || pathname.startsWith("/ws")) {
      return jsonError(c, "Unauthorized: 请先登录平台账号", 401);
    }
    // 页面请求放行：SPA fallback 返回 index.html，登录门在应用内完成认证。
    await next();
    return;
  };
}

function setSessionCookie(c: Context, token: string): void {
  c.header(
    "Set-Cookie",
    `${PLATFORM_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`,
  );
}

export function registerPlatformRoutes(app: Hono, deps: PlatformDeps): void {
  const { search } = deps;
  const requireStore = (c: Context): PlatformStore | Response => {
    if (!deps.store) return jsonError(c, "平台用户系统未启用（设置 ZCODE_PLATFORM_AUTH=1 开启）", 403);
    return deps.store;
  };
  const requireAdmin = (c: Context): PlatformUser | Response => {
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (user?.role !== "admin") return jsonError(c, "需要管理员权限", 403);
    return user;
  };
  const storeOf = (c: Context): PlatformStore | undefined => {
    const store = requireStore(c);
    return store instanceof Response ? undefined : store;
  };
  const adminOf = (c: Context): PlatformUser | undefined => {
    const admin = requireAdmin(c);
    return admin instanceof Response ? undefined : admin;
  };

  // ---------- 认证（无需会话） ----------
  app.post("/api/platform/auth/setup-status", (c) => {
    if (!deps.store) return c.json({ needsSetup: false, registrationOpen: false, enabled: false });
    const config = deps.store.getConfig();
    return c.json({
      needsSetup: deps.store.needsSetup,
      registrationOpen: config.enableSignup,
      requireInvite: config.requireInvite,
      enabled: true,
      ...(config.loginNotice ? { notice: config.loginNotice } : {}),
    });
  });

  // 邀请码预检（公开，注册页输入即校验）。
  app.get("/api/platform/auth/invite/:code", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const result = store.validateInvite(c.req.param("code"));
    return c.json({
      valid: result.valid,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.invite?.note ? { note: result.invite.note } : {}),
      ...(result.invite?.defaultRole ? { defaultRole: result.invite.defaultRole } : {}),
    });
  });

  app.post("/api/platform/auth/register", async (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const config = store.getConfig();
    const isFirstUser = store.needsSetup;
    if (!isFirstUser && !config.enableSignup) {
      return jsonError(c, "注册已关闭，请联系管理员创建账号", 403);
    }
    const body = await readJson(c);
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    const inviteCode = String(body.inviteCode ?? "").trim();
    try {
      // 邀请码：系统开启 requireInvite（或本次注册携带了邀请码）时校验并消耗。
      let inviteDefaultRole: "user" | "pending" | undefined;
      if (isFirstUser) {
        // 首个用户直接成为 admin，不消耗邀请码。
      } else if (config.requireInvite || inviteCode) {
        if (config.requireInvite && !inviteCode) {
          return jsonError(c, "此站点需要邀请码才能注册", 403);
        }
        const check = store.validateInvite(inviteCode);
        if (!check.valid) return jsonError(c, check.reason ?? "邀请码无效", 403);
        inviteDefaultRole = check.invite?.defaultRole;
      }
      const user = store.createUser({
        username,
        password,
        ...(isFirstUser ? { role: "admin" as const } : inviteDefaultRole ? { role: inviteDefaultRole } : {}),
      });
      if (!isFirstUser && (config.requireInvite || inviteCode)) {
        store.consumeInvite(inviteCode);
      }
      const session = store.createSession(user.id);
      store.recordEvent(isFirstUser ? "auth.setup_admin" : "auth.register", user);
      setSessionCookie(c, session.token);
      return c.json({
        ok: true,
        username: user.username,
        role: user.role,
        ...(user.role === "pending" ? { pendingNotice: config.pendingNotice } : {}),
      });
    } catch (error) {
      store.recordEvent("auth.register_failed", undefined, username);
      return jsonError(c, error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/api/platform/auth/login", async (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const body = await readJson(c);
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    try {
      const user = store.verifyLogin(username, password);
      if (!user) {
        store.recordEvent("auth.login_failed", undefined, username);
        return jsonError(c, "用户名或密码错误", 401);
      }
      const session = store.createSession(user.id);
      store.recordEvent("auth.login", user);
      setSessionCookie(c, session.token);
      return c.json({
        ok: true,
        username: user.username,
        role: user.role,
        ...(user.role === "pending" ? { pendingNotice: store.getConfig().pendingNotice } : {}),
      });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error), 401);
    }
  });

  // ---------- 认证（需要会话） ----------
  app.post("/api/platform/auth/logout", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const cookies = parseCookieHeader(c.req.header("cookie"));
    const token = cookies.get(PLATFORM_SESSION_COOKIE);
    const logoutUser = token ? store.getSession(token)?.user : undefined;
    if (token) store.deleteSession(token);
    if (logoutUser) store.recordEvent("auth.logout", logoutUser);
    c.header("Set-Cookie", `${PLATFORM_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return c.json({ ok: true });
  });

  app.get("/api/platform/auth/me", (c) => {
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (!deps.store || !user) return jsonError(c, "Unauthorized", 401);
    const active = user.role === "user" || user.role === "admin";
    return c.json({
      id: user.id,
      username: user.username,
      role: user.role,
      status: user.status,
      permissions: {
        canShare: active && deps.store.hasPermission(user, "chat.share"),
        canSharePublicly: active && deps.store.hasPermission(user, "sharing.public"),
      },
      ...(user.displayName ? { displayName: user.displayName } : {}),
    });
  });

  app.post("/api/platform/auth/change-password", async (c) => {
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (!deps.store || !user) return jsonError(c, "Unauthorized", 401);
    const body = await readJson(c);
    try {
      if (String(body.newPassword ?? "").length < PASSWORD_MIN) {
        throw new Error(`新密码长度至少 ${PASSWORD_MIN} 位`);
      }
      deps.store.changePassword(user.id, String(body.currentPassword ?? ""), String(body.newPassword ?? ""));
      return c.json({ ok: true });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error));
    }
  });

  // ---------- 旧平台独立页面入口：全部收敛到 SPA 内原生界面 ----------
  // 登录页/管理控制台/分享中心已分别融合为 SPA 登录门与设置页「平台中心」「平台管理」
  // 分区，这里仅保留 302 兼容旧链接与收藏夹。
  const redirectLegacyPlatformPage = (c: Context) => c.redirect("/", 302);
  app.get("/login", redirectLegacyPlatformPage);
  app.get("/platform/admin", redirectLegacyPlatformPage);
  app.get("/platform/shares", redirectLegacyPlatformPage);

  app.get("/healthz", (c) => c.json({ ok: true }));

  // ---------- 管理员：系统配置 ----------
  app.get("/api/platform/admin/config", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const _admin = requireAdmin(c);
    if (_admin instanceof Response) return _admin;
    return c.json(store.getConfig());
  });

  app.put("/api/platform/admin/config", async (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const _admin = requireAdmin(c);
    if (_admin instanceof Response) return _admin;
    const body = await readJson(c);
    return c.json(
      store.updateConfig({
        ...(body.enableSignup !== undefined ? { enableSignup: Boolean(body.enableSignup) } : {}),
        ...(body.requireInvite !== undefined ? { requireInvite: Boolean(body.requireInvite) } : {}),
        ...(body.defaultRole !== undefined
          ? { defaultRole: body.defaultRole === "pending" ? "pending" : "user" }
          : {}),
        ...(body.loginNotice !== undefined ? { loginNotice: String(body.loginNotice) } : {}),
        ...(body.pendingNotice !== undefined ? { pendingNotice: String(body.pendingNotice) } : {}),
        ...(body.announcementEnabled !== undefined
          ? { announcementEnabled: Boolean(body.announcementEnabled) }
          : {}),
        ...(body.announcementTitle !== undefined
          ? { announcementTitle: String(body.announcementTitle) }
          : {}),
        ...(body.announcementBody !== undefined
          ? { announcementBody: String(body.announcementBody) }
          : {}),
      }),
    );
  });

  // ---------- 管理员：用户管理 ----------
  app.get("/api/platform/admin/users", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const _admin = requireAdmin(c);
    if (_admin instanceof Response) return _admin;
    const users = store.listUsers().map((u) => ({
      ...u,
      groupIds: store.getGroupIdsForUser(u.id),
      groupNames: store
        .listGroups()
        .filter((g) => store.getGroupIdsForUser(u.id).includes(g.id))
        .map((g) => g.name),
    }));
    return c.json({ users });
  });

  app.post("/api/platform/admin/users", async (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const admin = requireAdmin(c);
    if (admin instanceof Response) return admin;
    const body = await readJson(c);
    try {
      const created = store.createUser({
        username: String(body.username ?? "").trim(),
        password: String(body.password ?? ""),
        role: body.role === "admin" ? "admin" : body.role === "pending" ? "pending" : "user",
      });
      const groupIds = Array.isArray(body.groupIds) ? body.groupIds.map(String) : [];
      for (const gid of groupIds) store.addGroupMembers(gid, [created.id]);
      return c.json({ ok: true, user: created });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error));
    }
  });

  app.patch("/api/platform/admin/users/:id", async (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const admin = requireAdmin(c);
    if (admin instanceof Response) return admin;
    const id = c.req.param("id");
    const body = await readJson(c);
    try {
      switch (body.action) {
        case "disable": {
          if (id === admin.id) throw new Error("不能禁用自己");
          return c.json({ ok: true, user: store.setUserStatus(id, "disabled") });
        }
        case "enable":
          return c.json({ ok: true, user: store.setUserStatus(id, "active") });
        case "approve":
          return c.json({ ok: true, user: store.setUserRole(id, "user") });
        case "makeAdmin":
          return c.json({ ok: true, user: store.setUserRole(id, "admin") });
        case "makeUser":
          return c.json({ ok: true, user: store.setUserRole(id, "user") });
        case "resetPassword": {
          store.resetPassword(id, String(body.password ?? ""));
          return c.json({ ok: true });
        }
        default:
          return jsonError(c, "未知操作");
      }
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error));
    }
  });

  app.delete("/api/platform/admin/users/:id", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const admin = requireAdmin(c);
    if (admin instanceof Response) return admin;
    try {
      if (c.req.param("id") === admin.id) throw new Error("不能删除自己");
      return c.json({ ok: store.deleteUser(c.req.param("id")) });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error));
    }
  });

  // ---------- 用户组 ----------
  app.get("/api/platform/groups", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (!user) return jsonError(c, "Unauthorized", 401);
    // 管理员看全部；普通用户只看自己所在的组（OpenWebUI 同款语义）。
    const groups =
      user.role === "admin"
        ? store.listGroups({ withMembers: true })
        : store.listGroups({ userId: user.id });
    return c.json({ groups });
  });

  app.post("/api/platform/admin/groups", async (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const admin = requireAdmin(c);
    if (admin instanceof Response) return admin;
    const body = await readJson(c);
    try {
      const created = store.createGroup({
        name: String(body.name ?? ""),
        ...(body.description !== undefined ? { description: String(body.description) } : {}),
        ...(body.permissions !== undefined && typeof body.permissions === "object"
          ? { permissions: body.permissions as Record<string, boolean> }
          : {}),
        createdBy: admin.id,
        ...(Array.isArray(body.memberIds) ? { memberIds: body.memberIds.map(String) } : {}),
      });
      return c.json({ ok: true, group: created });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error));
    }
  });

  app.patch("/api/platform/admin/groups/:id", async (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const _admin = requireAdmin(c);
    if (_admin instanceof Response) return _admin;
    const body = await readJson(c);
    try {
      const updated = store.updateGroup(c.req.param("id"), {
        ...(body.name !== undefined ? { name: String(body.name) } : {}),
        ...(body.description !== undefined ? { description: String(body.description) } : {}),
        ...(body.permissions !== undefined && typeof body.permissions === "object"
          ? { permissions: body.permissions as Record<string, boolean> }
          : {}),
      });
      if (!updated) return jsonError(c, "组不存在", 404);
      if (Array.isArray(body.memberIds)) {
        const target = store.getGroup(c.req.param("id"));
        const current = new Set(target?.memberIds ?? []);
        const next = new Set(body.memberIds.map(String));
        const toAdd = [...next].filter((id) => !current.has(id));
        const toRemove = [...current].filter((id) => !next.has(id));
        if (toAdd.length > 0) store.addGroupMembers(c.req.param("id"), toAdd);
        if (toRemove.length > 0) store.removeGroupMembers(c.req.param("id"), toRemove);
      }
      return c.json({ ok: true, group: store.getGroup(c.req.param("id")) });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error));
    }
  });

  app.delete("/api/platform/admin/groups/:id", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const _admin = requireAdmin(c);
    if (_admin instanceof Response) return _admin;
    return c.json({ ok: store.deleteGroup(c.req.param("id")) });
  });

  // ---------- 管理员：邀请码 ----------
  app.get("/api/platform/admin/invites", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const _admin = requireAdmin(c);
    if (_admin instanceof Response) return _admin;
    return c.json({ invites: store.listInvites() });
  });

  app.post("/api/platform/admin/invites", async (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const admin = requireAdmin(c);
    if (admin instanceof Response) return admin;
    const body = await readJson(c);
    try {
      const invite = store.createInvite({
        createdBy: admin.username,
        ...(body.maxUses !== undefined ? { maxUses: Number(body.maxUses) } : {}),
        ...(body.expiresInDays !== undefined ? { expiresInDays: Number(body.expiresInDays) } : {}),
        ...(body.defaultRole !== undefined && body.defaultRole !== "admin"
          ? { defaultRole: body.defaultRole === "pending" ? "pending" : "user" }
          : {}),
        ...(body.note !== undefined ? { note: String(body.note) } : {}),
      });
      return c.json({ ok: true, invite });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error));
    }
  });

  app.patch("/api/platform/admin/invites/:code", async (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const _admin = requireAdmin(c);
    if (_admin instanceof Response) return _admin;
    const body = await readJson(c);
    const invite = store.setInviteDisabled(c.req.param("code"), Boolean(body.disabled));
    if (!invite) return jsonError(c, "邀请码不存在", 404);
    return c.json({ ok: true, invite });
  });

  app.delete("/api/platform/admin/invites/:code", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const _admin = requireAdmin(c);
    if (_admin instanceof Response) return _admin;
    return c.json({ ok: store.deleteInvite(c.req.param("code")) });
  });

  // ---------- 分享：创建 / 管理（需会话 + chat.share 权限） ----------
  const shareUser = (c: Context): PlatformUser | undefined => {
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (!deps.store || !user) return undefined;
    if (user.role !== "admin" && !deps.store.hasPermission(user, "chat.share")) return undefined;
    return user;
  };

  app.get("/api/platform/resources", (c) => {
    const user = shareUser(c);
    if (!user || !deps.snapshot) return jsonError(c, user ? "快照服务不可用" : "需要分享权限", 403);
    const availability = deps.snapshot.available;
    return c.json({
      sessions: availability.sessions ? deps.snapshot.listSessions(100) : [],
      tasks: availability.tasks ? deps.snapshot.listTasks(100) : [],
      projects: availability.tasks ? deps.snapshot.listProjects(50) : [],
    });
  });

  app.get("/api/platform/shares", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (!user) return jsonError(c, "Unauthorized", 401);
    return c.json({
      shares: user.role === "admin" ? store.listShares() : store.listShares({ ownerId: user.id }),
    });
  });

  app.post("/api/platform/shares", async (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const user = shareUser(c);
    if (!user) return jsonError(c, "需要分享权限", 403);
    if (!deps.snapshot) return jsonError(c, "快照服务不可用", 503);
    const body = await readJson(c);
    const resourceType = String(body.resourceType ?? "");
    const resourceId = String(body.resourceId ?? "").trim();
    const visibility = body.visibility === "open" ? "open" : "public";
    if (!["session", "task", "project"].includes(resourceType)) {
      return jsonError(c, "resourceType 需为 session/task/project");
    }
    if (!resourceId) return jsonError(c, "resourceId 不能为空");
    // open（免登录互联网可读）受 sharing.public 权限控制（OpenWebUI open_chats 同款开关）。
    if (visibility === "open" && user.role !== "admin" && !store.hasPermission(user, "sharing.public")) {
      return jsonError(c, "没有公开分享权限（sharing.public）", 403);
    }
    const snapshot = deps.snapshot.snapshot(resourceType as "session" | "task" | "project", resourceId);
    if (!snapshot) return jsonError(c, "资源不存在或没有可分享的内容", 404);
    const title = "title" in snapshot ? String(snapshot.title) : "(未命名)";
    try {
      const share = store.createShare({
        resourceType: resourceType as "session" | "task" | "project",
        resourceId,
        title,
        visibility,
        ownerId: user.id,
        snapshot,
      });
      store.recordEvent("share.create", user, `${resourceType}: ${title}`);
      return c.json({ ok: true, url: `/s/${share.token}`, share: { ...share, snapshot: undefined } });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error));
    }
  });

  app.patch("/api/platform/shares/:token", async (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (!user) return jsonError(c, "Unauthorized", 401);
    const share = store.getShare(c.req.param("token"));
    if (!share) return jsonError(c, "分享不存在", 404);
    if (user.role !== "admin" && share.ownerId !== user.id) {
      return jsonError(c, "只能管理自己的分享", 403);
    }
    const body = await readJson(c);
    if (body.visibility !== undefined) {
      const visibility = body.visibility === "open" ? "open" : "public";
      if (visibility === "open" && user.role !== "admin" && !store.hasPermission(user, "sharing.public")) {
        return jsonError(c, "没有公开分享权限（sharing.public）", 403);
      }
      store.updateShareVisibility(share.token, visibility);
    }
    if (body.refresh === true && deps.snapshot) {
      const snapshot = deps.snapshot.snapshot(share.resourceType, share.resourceId);
      if (snapshot) store.updateShareSnapshot(share.token, snapshot);
    }
    return c.json({ ok: true });
  });

  app.delete("/api/platform/shares/:token", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (!user) return jsonError(c, "Unauthorized", 401);
    const share = store.getShare(c.req.param("token"));
    if (!share) return jsonError(c, "分享不存在", 404);
    if (user.role !== "admin" && share.ownerId !== user.id) {
      return jsonError(c, "只能删除自己的分享", 403);
    }
    return c.json({ ok: store.deleteShare(share.token) });
  });

  // ---------- 分享：公开访问 ----------
  const readPublicShare = (
    c: Context,
  ): { ok: true; share: ReturnType<PlatformStore["getShare"]> } | { ok: false; response: Response } => {
    const store = requireStore(c);
    if (store instanceof Response) return { ok: false, response: store };
    const token = c.req.param("token");
    const share = store.getShare(token);
    if (!share) return { ok: false, response: jsonError(c, "分享不存在或已被删除", 404) };
    if (share.visibility !== "open") {
      const user = sessionFromRequest(c, store);
      if (!user) {
        return {
          ok: false,
          response: c.redirect(`/login?next=${encodeURIComponent(`/s/${token}`)}`, 302),
        };
      }
    }
    return { ok: true, share };
  };

  app.get("/api/platform/shares/public/:token", (c) => {
    const result = readPublicShare(c);
    if (!result.ok) return result.response;
    const store = deps.store!;
    const full = store.getShare(result.share!.token, { withSnapshot: true });
    store.incrementShareViewCount(result.share!.token);
    return c.json({ share: full });
  });

  app.get("/s/:token", (c) => {
    const result = readPublicShare(c);
    if (!result.ok) return result.response;
    const store = deps.store!;
    const full = store.getShare(result.share!.token, { withSnapshot: true });
    store.incrementShareViewCount(result.share!.token);
    return c.html(shareViewPageHtml(full!), 200);
  });

  // ---------- 联网搜索（会话或内部服务 Token） ----------
  const searchAuth = (c: Context): boolean => {
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (user) return true;
    const token = bearerFromRequest(c);
    return Boolean(deps.serviceToken && token && token === deps.serviceToken);
  };

  // 搜索配置读取无敏感信息，登录用户即可看；写配置需要管理员。
  app.get("/api/platform/search/providers", (c) => c.json({ providers: SEARCH_PROVIDERS }));

  app.get("/api/platform/search/config", (c) => {
    const config = search.config;
    return c.json({ ...config, ...(config.apiKey ? { apiKey: "" } : {}) });
  });

  app.put("/api/platform/search/config", async (c) => {
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (user?.role !== "admin") return jsonError(c, "需要管理员权限", 403);
    const body = await readJson(c);
    try {
      return c.json(
        search.updateConfig({
          ...(body.provider !== undefined ? { provider: String(body.provider) } : {}),
          ...(body.count !== undefined ? { count: Number(body.count) } : {}),
          ...(body.apiKey !== undefined ? { apiKey: String(body.apiKey) } : {}),
          ...(body.baseUrl !== undefined ? { baseUrl: String(body.baseUrl) } : {}),
          ...(body.engine !== undefined ? { engine: String(body.engine) } : {}),
          ...(body.apiToken !== undefined ? { apiToken: String(body.apiToken) } : {}),
        }),
      );
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/api/platform/search", async (c) => {
    if (!searchAuth(c)) return jsonError(c, "Unauthorized", 401);
    const query = c.req.query("q") ?? c.req.query("query") ?? "";
    const count = Number(c.req.query("count") ?? "") || undefined;
    const searchUser = c.get("platformUser") as PlatformUser | undefined;
    if (searchUser) deps.store?.recordEvent("search.query", searchUser, query.slice(0, 200));
    try {
      const results = await search.search(query, count);
      return c.json({ query, count: results.length, results });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error), 502);
    }
  });

  // ---------- 对外 OpenWebUI 兼容端点（/search） ----------
  // GET /search?q=&format=json  → SearXNG 引擎格式
  // POST /search {query, count} → OpenWebUI external 模式格式（[{link,title,snippet}]）
  const publicSearchAuthorized = (c: Context): boolean => {
    const requiredToken = search.config.apiToken?.trim();
    if (!requiredToken) return true;
    const bearer = bearerFromRequest(c);
    if (bearer === requiredToken) return true;
    return c.req.query("token") === requiredToken;
  };

  app.get("/search", async (c) => {
    if (!publicSearchAuthorized(c)) return jsonError(c, "Unauthorized", 401);
    const query = c.req.query("q") ?? "";
    const count = Number(c.req.query("count") ?? "") || undefined;
    if (!query.trim()) return c.json({ query: "", results: [] });
    try {
      const results = await search.search(query, count);
      return c.json({
        query,
        results: results.map((item) => ({
          title: item.title,
          url: item.url,
          content: item.snippet,
          snippet: item.snippet,
          link: item.url,
          provider: item.provider,
        })),
      });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error), 502);
    }
  });

  app.post("/search", async (c) => {
    if (!publicSearchAuthorized(c)) return jsonError(c, "Unauthorized", 401);
    const body = await readJson(c);
    const query = String(body.query ?? "");
    const count = Number(body.count ?? "") || undefined;
    if (!query.trim()) return c.json([]);
    try {
      const results = await search.search(query, count);
      return c.json(
        results.map((item) => ({ link: item.url, title: item.title, snippet: item.snippet })),
      );
    } catch {
      return c.json([]);
    }
  });

  // ---------- 提示词库（个人 + 管理员全局） ----------
  // 工作台公告横幅：任何活跃会话用户可读（pending 亦允许，便于展示站点通知）。
  app.get("/api/platform/announcement", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (!user) return jsonError(c, "Unauthorized", 401);
    const config = store.getConfig();
    return c.json({
      enabled: config.announcementEnabled && Boolean(config.announcementTitle || config.announcementBody),
      title: config.announcementTitle ?? "",
      body: config.announcementBody ?? "",
    });
  });

  app.get("/api/platform/prompts", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (!user) return jsonError(c, "Unauthorized", 401);
    if (user.role === "pending") return jsonError(c, "账号待审批", 403);
    return c.json({ prompts: store.listPrompts(user) });
  });

  app.post("/api/platform/prompts", async (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (!user) return jsonError(c, "Unauthorized", 401);
    if (user.role === "pending") return jsonError(c, "账号待审批", 403);
    if (user.role !== "admin" && !store.hasPermission(user, "workspace.prompts")) {
      return jsonError(c, "没有提示词库权限（workspace.prompts）", 403);
    }
    const body = await readJson(c);
    const title = String(body.title ?? "").trim();
    const content = String(body.content ?? "");
    if (!title) return jsonError(c, "标题不能为空");
    if (!content.trim()) return jsonError(c, "内容不能为空");
    const isGlobal = body.global === true && user.role === "admin";
    const prompt = store.createPrompt({
      ...(isGlobal ? {} : { ownerId: user.id }),
      title: title.slice(0, 200),
      content: content.slice(0, 32_000),
    });
    store.recordEvent("prompt.create", user, title);
    return c.json({ prompt });
  });

  app.patch("/api/platform/prompts/:id", async (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (!user) return jsonError(c, "Unauthorized", 401);
    const body = await readJson(c);
    try {
      const prompt = store.updatePrompt(c.req.param("id"), user, {
        ...(body.title !== undefined ? { title: String(body.title).slice(0, 200) } : {}),
        ...(body.content !== undefined ? { content: String(body.content).slice(0, 32_000) } : {}),
      });
      return c.json({ prompt });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error), 403);
    }
  });

  app.delete("/api/platform/prompts/:id", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (!user) return jsonError(c, "Unauthorized", 401);
    try {
      store.deletePrompt(c.req.param("id"), user);
      return c.json({ ok: true });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error), 403);
    }
  });

  // ---------- 知识库（管理员维护；agent 经 platform-knowledge MCP 检索） ----------
  app.get("/api/platform/kb", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const _admin = requireAdmin(c);
    if (_admin instanceof Response) return _admin;
    return c.json({ docs: store.listKbDocs() });
  });

  app.post("/api/platform/kb", async (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const admin = requireAdmin(c);
    if (admin instanceof Response) return admin;
    const body = await readJson(c);
    const title = String(body.title ?? "").trim();
    const content = String(body.content ?? "");
    const filename = body.filename ? String(body.filename).slice(0, 260) : undefined;
    if (!title) return jsonError(c, "标题不能为空");
    if (!content.trim()) return jsonError(c, "内容不能为空");
    if (content.length > 4_000_000) return jsonError(c, "文档过大（上限 4MB 文本）", 413);
    try {
      const doc = store.createKbDoc({
        title: title.slice(0, 200),
        ...(filename ? { filename } : {}),
        content,
        ownerId: admin.id,
      });
      store.recordEvent("kb.create", admin, title);
      return c.json({ doc });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error));
    }
  });

  app.delete("/api/platform/kb/:id", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const admin = requireAdmin(c);
    if (admin instanceof Response) return admin;
    store.deleteKbDoc(c.req.param("id"));
    store.recordEvent("kb.delete", admin, c.req.param("id"));
    return c.json({ ok: true });
  });

  // 知识库检索：会话用户或内部服务令牌（MCP server 用）。
  app.get("/api/platform/kb/search", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const user = c.get("platformUser") as PlatformUser | undefined;
    const bearer = bearerFromRequest(c);
    const authorized =
      user?.role === "user" ||
      user?.role === "admin" ||
      (deps.serviceToken && bearer === deps.serviceToken);
    if (!authorized) return jsonError(c, "Unauthorized", 401);
    const query = c.req.query("q") ?? c.req.query("query") ?? "";
    const limit = Number(c.req.query("limit") ?? "") || undefined;
    return c.json({ hits: store.searchKb(query, limit) });
  });

  // ---------- 用量统计与审计日志（管理员） ----------
  app.get("/api/platform/admin/stats", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const _admin = requireAdmin(c);
    if (_admin instanceof Response) return _admin;
    return c.json(store.getStats());
  });

  app.get("/api/platform/admin/events", (c) => {
    const store = requireStore(c);
    if (store instanceof Response) return store;
    const _admin = requireAdmin(c);
    if (_admin instanceof Response) return _admin;
    const type = c.req.query("type") || undefined;
    const limit = Number(c.req.query("limit") ?? "") || undefined;
    return c.json({ events: store.listEvents({ ...(type ? { type } : {}), ...(limit ? { limit } : {}) }) });
  });

  // ---------- 浏览器桥状态 ----------
  app.get("/api/platform/browser/status", async (c) => {
    if (!deps.browser) {
      return c.json({ enabled: false });
    }
    // probe=1 时主动探测远程浏览器连通性（否则返回缓存状态）。
    // available → connected：执行桥内部字段名为 available，管理台 UI 消费 connected。
    if (c.req.query("probe") === "1") {
      const probed = await deps.browser.probe();
      return c.json({ enabled: true, ...probed, connected: probed.available });
    }
    const cached = deps.browser.status();
    return c.json({ enabled: true, ...cached, connected: cached.available });
  });
}
