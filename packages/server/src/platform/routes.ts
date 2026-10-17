import type { Context, Hono } from "hono";
import { parseCookieHeader } from "./cookies.js";
import type { PlatformStore } from "./store.js";
import { PASSWORD_MIN, type PlatformUser } from "./store.js";
import { SearchService, SEARCH_PROVIDERS } from "./search.js";
import type { RemoteBrowserExecutor } from "@zcode/browser-remote";
import { adminPageHtml, loginPageHtml } from "./pages.js";

/**
 * 平台路由：自有用户/登录系统（替代官方 z.ai 登录）+ 联网搜索服务（多 Provider +
 * OpenWebUI 自定义模式兼容端点）+ 远程浏览器桥状态 + 管理控制台。
 *
 * 鉴权模型：
 * - 平台开启后（ZCODE_PLATFORM_AUTH=1），除 /api/platform/auth/*、/login、/healthz 外，
 *   所有请求都需要有效会话 Cookie（zcode_platform_session）；未登录的页面请求 302 → /login。
 * - 对外搜索端点 /search 用可选 Bearer Token（search.json 的 apiToken）保护，供 OpenWebUI 等外部系统接入。
 * - 内部服务（如搜索 MCP server）用 ZCODE_PLATFORM_SERVICE_TOKEN Bearer Token 访问 /api/platform/search。
 */

export const PLATFORM_SESSION_COOKIE = "zcode_platform_session";

export interface PlatformDeps {
  /** 平台用户存储；未启用平台登录（ZCODE_PLATFORM_AUTH=1）时省略。 */
  store?: PlatformStore;
  search: SearchService;
  browser?: RemoteBrowserExecutor;
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
    // 对外搜索端点（OpenWebUI / MCP server 接入）有独立的 Token 校验，不走平台会话强制鉴权。
    const isPublicSearch = pathname === "/search" || pathname === "/api/platform/search";
    // 无论是否强制鉴权，都先解析会话（/me、搜索 API、公共端点在已登录时需要 platformUser）。
    const user = sessionFromRequest(c, deps.store);
    if (user) c.set("platformUser", user);
    if (isAuthPath || isLoginHtml || isHealth || isPublicSearch) {
      await next();
      return;
    }
    if (user) {
      await next();
      return;
    }
    if (pathname.startsWith("/api/") || pathname.startsWith("/ws")) {
      return jsonError(c, "Unauthorized: 请先登录平台账号", 401);
    }
    return c.redirect("/login", 302);
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
  const requireStore = (c: Context): PlatformStore | undefined => {
    if (!deps.store) {
      jsonError(c, "平台用户系统未启用（设置 ZCODE_PLATFORM_AUTH=1 开启）", 403);
      return undefined;
    }
    return deps.store;
  };

  // ---------- 认证（无需会话） ----------
  app.post("/api/platform/auth/setup-status", (c) => {
    if (!deps.store) return c.json({ needsSetup: false, registrationOpen: false, enabled: false });
    return c.json({ needsSetup: deps.store.needsSetup, registrationOpen: true, enabled: true });
  });

  app.post("/api/platform/auth/register", async (c) => {
    const store = requireStore(c);
    if (!store) return;
    const body = await readJson(c);
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    try {
      const isFirstUser = store.needsSetup;
      const user = store.createUser({ username, password, ...(isFirstUser ? { role: "admin" as const } : {}) });
      const session = store.createSession(user.id);
      setSessionCookie(c, session.token);
      return c.json({ ok: true, username: user.username, role: user.role });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/api/platform/auth/login", async (c) => {
    const store = requireStore(c);
    if (!store) return;
    const body = await readJson(c);
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    try {
      const user = store.verifyLogin(username, password);
      if (!user) return jsonError(c, "用户名或密码错误", 401);
      const session = store.createSession(user.id);
      setSessionCookie(c, session.token);
      return c.json({ ok: true, username: user.username, role: user.role });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error), 401);
    }
  });

  // ---------- 认证（需要会话） ----------
  app.post("/api/platform/auth/logout", (c) => {
    const store = requireStore(c);
    if (!store) return;
    const cookies = parseCookieHeader(c.req.header("cookie"));
    const token = cookies.get(PLATFORM_SESSION_COOKIE);
    if (token) store.deleteSession(token);
    c.header("Set-Cookie", `${PLATFORM_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return c.json({ ok: true });
  });

  app.get("/api/platform/auth/me", (c) => {
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (!deps.store || !user) return jsonError(c, "Unauthorized", 401);
    return c.json({
      id: user.id,
      username: user.username,
      role: user.role,
      status: user.status,
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

  // ---------- 登录页 / 管理页 ----------
  app.get("/login", (c) => {
    if (!deps.store) return jsonError(c, "平台用户系统未启用", 403);
    return c.html(loginPageHtml(deps.store.needsSetup, true), 200);
  });

  app.get("/platform/admin", (c) => {
    if (!deps.store) return jsonError(c, "平台用户系统未启用", 403);
    const user = sessionFromRequest(c, deps.store);
    if (!user) return c.redirect("/login", 302);
    return c.html(adminPageHtml(), 200);
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  // ---------- 管理员：用户管理 ----------
  app.get("/api/platform/admin/users", (c) => {
    const store = requireStore(c);
    if (!store) return;
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (user?.role !== "admin") return jsonError(c, "需要管理员权限", 403);
    return c.json({ users: store.listUsers() });
  });

  app.post("/api/platform/admin/users", async (c) => {
    const store = requireStore(c);
    if (!store) return;
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (user?.role !== "admin") return jsonError(c, "需要管理员权限", 403);
    const body = await readJson(c);
    try {
      const created = store.createUser({
        username: String(body.username ?? "").trim(),
        password: String(body.password ?? ""),
        role: body.role === "admin" ? "admin" : "user",
      });
      return c.json({ ok: true, user: created });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error));
    }
  });

  app.patch("/api/platform/admin/users/:id", async (c) => {
    const store = requireStore(c);
    if (!store) return;
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (user?.role !== "admin") return jsonError(c, "需要管理员权限", 403);
    const id = c.req.param("id");
    const body = await readJson(c);
    try {
      switch (body.action) {
        case "disable": {
          if (id === user.id) throw new Error("不能禁用自己");
          return c.json({ ok: true, user: store.setUserStatus(id, "disabled") });
        }
        case "enable":
          return c.json({ ok: true, user: store.setUserStatus(id, "active") });
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
    if (!store) return;
    const user = c.get("platformUser") as PlatformUser | undefined;
    if (user?.role !== "admin") return jsonError(c, "需要管理员权限", 403);
    try {
      if (c.req.param("id") === user.id) throw new Error("不能删除自己");
      return c.json({ ok: store.deleteUser(c.req.param("id")) });
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : String(error));
    }
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

  // ---------- 浏览器桥状态 ----------
  app.get("/api/platform/browser/status", async (c) => {
    if (!deps.browser) {
      return c.json({ enabled: false });
    }
    // probe=1 时主动探测远程浏览器连通性（否则返回缓存状态）。
    if (c.req.query("probe") === "1") {
      return c.json({ enabled: true, ...(await deps.browser.probe()) });
    }
    return c.json({ enabled: true, ...deps.browser.status() });
  });
}
