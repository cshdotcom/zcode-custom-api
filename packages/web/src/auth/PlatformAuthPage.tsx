import { useEffect, useState } from "react";
import { Button, Input, readStoredLocalePreference, setPlatformAuthConfig, writeStoredLocalePreference } from "@zcode/ui";
import { getPlatformAuthCopy } from "./platformAuthLocale.js";
import type { PlatformAuthLocale } from "./platformAuthLocale.js";

/**
 * 平台登录门（深度融合版）：替代旧的独立手写登录页。
 * 视觉与结构与官方 WebLoginPage 完全同源——同一张卡片、同一套设计 token、
 * 同一组 @zcode/ui 原语，只是把「用 Z.AI 登录」替换为平台账号体系
 * （登录 / 注册 / 首次初始化管理员 / 等待审批），由 SPA 启动门直接渲染。
 */

interface PlatformAuthPageProps {
  onAuthenticated: () => void;
}

type AuthMode = "login" | "register" | "setup";

interface SetupStatusResponse {
  enabled: boolean;
  needsSetup: boolean;
  registrationOpen: boolean;
  requireInvite: boolean;
  notice?: string;
}

interface AuthResponse {
  ok?: boolean;
  username?: string;
  role?: "admin" | "user" | "pending";
  pendingNotice?: string;
  error?: string;
}

async function postJson(url: string, body: unknown): Promise<{ status: number; data: AuthResponse }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: AuthResponse = {};
  try {
    data = (await response.json()) as AuthResponse;
  } catch {
    data = {};
  }
  return { status: response.status, data };
}

function resolveSafeNextPath(): string | null {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

export function PlatformAuthPage({ onAuthenticated }: PlatformAuthPageProps) {
  // 登录门内置中/EN 切换：写 localStorage 偏好 + 同步文档语言，重渲染后 copy 重新解析。
  const [localeVersion, setLocaleVersion] = useState(0);
  const currentLocale: PlatformAuthLocale = readStoredLocalePreference()
    ?? (document.documentElement.lang.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US");
  const toggleLocale = (): void => {
    writeStoredLocalePreference(currentLocale === "zh-CN" ? "en-US" : "zh-CN");
    setLocaleVersion((version) => version + 1);
  };
  void localeVersion; // copy 在渲染期重解析，版本号仅用于触发重渲染
  const copy = getPlatformAuthCopy();
  const [mode, setMode] = useState<AuthMode>("login");
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [requireInvite, setRequireInvite] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/platform/auth/setup-status", {
          method: "POST",
          headers: { accept: "application/json" },
        });
        if (!response.ok) return;
        const status = (await response.json()) as SetupStatusResponse;
        if (cancelled) return;
        setPlatformAuthConfig({
          enabled: status.enabled,
          needsSetup: status.needsSetup,
          registrationOpen: status.registrationOpen,
          requireInvite: status.requireInvite,
          ...(status.notice ? { notice: status.notice } : {}),
        });
        setRegistrationOpen(status.registrationOpen);
        setRequireInvite(status.requireInvite);
        if (status.notice) setNotice(status.notice);
        if (status.needsSetup) setMode("setup");
      } catch {
        // 状态接口失败时保持登录模式，提交时由服务端给出明确错误。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (): Promise<void> => {
    if (busy) return;
    setError(null);
    if (mode !== "login" && password !== confirmPassword) {
      setError(copy.passwordLabel + "与" + copy.confirmPasswordLabel + "不一致");
      return;
    }
    setBusy(true);
    try {
      const url =
        mode === "login" ? "/api/platform/auth/login" : "/api/platform/auth/register";
      const body =
        mode === "login"
          ? { username: username.trim(), password }
          : {
              username: username.trim(),
              password,
              ...(inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}),
            };
      const { status, data } = await postJson(url, body);
      if (status !== 200 || !data.ok) {
        setError(data.error || `请求失败（${status}）`);
        return;
      }
      if (data.role === "pending") {
        setPendingNotice(data.pendingNotice || "");
        return;
      }
      const nextPath = resolveSafeNextPath();
      if (nextPath) {
        window.location.replace(nextPath);
        return;
      }
      onAuthenticated();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy(false);
    }
  };

  const logoutPending = async (): Promise<void> => {
    await fetch("/api/platform/auth/logout", { method: "POST" }).catch(() => undefined);
    setPendingNotice(null);
    setPassword("");
    setMode("login");
  };

  if (pendingNotice !== null) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 text-foreground">
        <section className="relative w-full max-w-sm rounded-lg border border-card-border bg-card p-5 shadow-sm">
          <LocaleToggleButton current={currentLocale} onToggle={toggleLocale} />
          <div className="mb-5 flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-ui-xs font-semibold text-foreground">
              Z
            </div>
            <div className="min-w-0">
              <div className="text-ui-xs font-medium text-foreground">{copy.brand}</div>
              <h1 className="text-ui-lg font-medium text-foreground">{copy.pendingTitle}</h1>
            </div>
          </div>
          <p className="mb-5 text-ui-xs leading-6 text-foreground-subtle">
            {pendingNotice || copy.pendingTitle}
          </p>
          <Button type="button" size="lg" variant="outline" className="w-full" onClick={() => void logoutPending()}>
            {copy.logoutAction}
          </Button>
        </section>
      </main>
    );
  }

  const title = mode === "setup" ? copy.setupTitle : copy.loginTitle;
  const description = mode === "setup" ? copy.setupDescription : copy.loginDescription;
  const actionLabel = busy
    ? copy.submittingAction
    : mode === "setup"
      ? copy.setupAction
      : mode === "login"
        ? copy.loginAction
        : copy.registerAction;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="relative w-full max-w-sm rounded-lg border border-card-border bg-card p-5 shadow-sm">
        <LocaleToggleButton current={currentLocale} onToggle={toggleLocale} />
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-ui-xs font-semibold text-foreground">
            Z
          </div>
          <div className="min-w-0">
            <div className="text-ui-xs font-medium text-foreground">{copy.brand}</div>
            <h1 className="text-ui-lg font-medium text-foreground">{title}</h1>
          </div>
        </div>
        <p className="mb-4 text-ui-xs leading-6 text-foreground-subtle">{description}</p>
        {notice ? (
          <div className="mb-4 rounded-md border border-card-border bg-accent px-3 py-2 text-ui-xs leading-5 text-foreground-subtle">
            {notice}
          </div>
        ) : null}
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-ui-xs font-medium text-foreground-subtle">{copy.usernameLabel}</span>
            <Input
              size="lg"
              name="username"
              autoComplete="username"
              autoFocus
              placeholder={copy.usernamePlaceholder}
              value={username}
              disabled={busy}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ui-xs font-medium text-foreground-subtle">{copy.passwordLabel}</span>
            <Input
              size="lg"
              type="password"
              name="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder={copy.passwordPlaceholder}
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {mode !== "login" ? (
            <label className="flex flex-col gap-1">
              <span className="text-ui-xs font-medium text-foreground-subtle">
                {copy.confirmPasswordLabel}
              </span>
              <Input
                size="lg"
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                placeholder={copy.confirmPasswordLabel}
                value={confirmPassword}
                disabled={busy}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
          ) : null}
          {mode === "register" && requireInvite ? (
            <label className="flex flex-col gap-1">
              <span className="text-ui-xs font-medium text-foreground-subtle">{copy.inviteCodeLabel}</span>
              <Input
                size="lg"
                name="inviteCode"
                placeholder={copy.inviteCodePlaceholder}
                value={inviteCode}
                disabled={busy}
                onChange={(event) => setInviteCode(event.target.value)}
              />
            </label>
          ) : null}
          {error ? <p className="text-ui-xs leading-5 text-destructive">{error}</p> : null}
          <Button type="submit" size="lg" className="mt-1 w-full" disabled={busy || !username.trim() || !password}>
            {actionLabel}
          </Button>
        </form>
        {mode !== "setup" ? (
          <div className="mt-4 text-center">
            {mode === "login" ? (
              registrationOpen ? (
                <button
                  type="button"
                  className="text-ui-xs text-foreground-subtle underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => {
                    setMode("register");
                    setError(null);
                  }}
                >
                  {copy.toRegister}
                </button>
              ) : null
            ) : (
              <button
                type="button"
                className="text-ui-xs text-foreground-subtle underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                {copy.toLogin}
              </button>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}

/** 登录卡片右上角的中/EN 语言切换（当前语言之外的目标语言以按钮形式展示）。 */
function LocaleToggleButton({
  current,
  onToggle,
}: {
  current: PlatformAuthLocale;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="absolute right-3 top-3 rounded-md border border-card-border px-2 py-1 text-ui-xs text-foreground-subtle transition-colors hover:bg-accent hover:text-foreground"
      aria-label={current === "zh-CN" ? "Switch to English" : "切换到中文"}
      onClick={onToggle}
    >
      {current === "zh-CN" ? "EN" : "中文"}
    </button>
  );
}
