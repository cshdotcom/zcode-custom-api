import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Badge } from "@/components/ui/badge.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { Spinner } from "@/components/ui/spinner.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { usePlatformUser } from "@/platformUserStore.js";
import {
  PlatformApiError,
  platformApi,
  platformApiDelete,
  type PlatformShareRow,
} from "./platformApi.js";
import { getPlatformSectionCopy } from "./platformLocale.js";

/**
 * 设置页「平台中心」分区（所有平台用户可见）：
 * - 账号：平台身份、角色与修改密码；
 * - 我的分享：对话 / 任务 / 项目快照链接管理（可见性切换、刷新快照、撤销）。
 * 与其他官方分区同一套卡片与排版语言，管理员能力在「平台管理」分区。
 */

function formatDateTime(value: number | undefined, locale: string): string {
  if (!value) return "—";
  try {
    return new Date(Number(value)).toLocaleString(locale.startsWith("zh") ? "zh-CN" : "en-US");
  } catch {
    return "—";
  }
}

export function PlatformSection() {
  const { intl } = useZCodeIntl();
  const copy = getPlatformSectionCopy(intl.locale);
  const platformUser = usePlatformUser();

  const [shares, setShares] = useState<PlatformShareRow[] | null>(null);
  const [sharesError, setSharesError] = useState<string | null>(null);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [confirmToken, setConfirmToken] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordUpdated, setPasswordUpdated] = useState(false);

  const loadShares = useCallback(async (): Promise<void> => {
    setSharesError(null);
    try {
      const data = await platformApi<{ shares: PlatformShareRow[] }>("/api/platform/shares");
      setShares(data.shares);
    } catch (error) {
      setShares([]);
      setSharesError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    if (!platformUser) return;
    void loadShares();
  }, [platformUser, loadShares]);

  if (!platformUser) {
    return (
      <div className="space-y-4" data-testid="settings-platform-section">
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-ui-sm text-foreground-subtle">
          {copy.platformDisabledHint}
        </p>
      </div>
    );
  }

  const roleLabel =
    platformUser.role === "admin"
      ? copy.roleAdmin
      : platformUser.role === "pending"
        ? copy.rolePending
        : copy.roleUser;

  const patchShare = async (token: string, body: Record<string, unknown>): Promise<void> => {
    setBusyToken(token);
    setHint(null);
    try {
      await platformApi(`/api/platform/shares/${token}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await loadShares();
    } catch (error) {
      setSharesError(
        error instanceof PlatformApiError ? error.message : `${copy.loadFailed}: ${String(error)}`,
      );
    } finally {
      setBusyToken(null);
    }
  };

  const deleteShare = async (token: string): Promise<void> => {
    setBusyToken(token);
    setHint(null);
    try {
      await platformApiDelete(`/api/platform/shares/${token}`);
      setConfirmToken(null);
      await loadShares();
    } catch (error) {
      setSharesError(
        error instanceof PlatformApiError ? error.message : `${copy.loadFailed}: ${String(error)}`,
      );
    } finally {
      setBusyToken(null);
    }
  };

  const copyShareLink = async (token: string): Promise<void> => {
    const url = `${window.location.origin}/s/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setHint(copy.linkCopied);
    } catch {
      window.prompt(copy.copyLinkAction, url);
    }
  };

  const submitPassword = async (): Promise<void> => {
    if (passwordBusy) return;
    setPasswordError(null);
    setPasswordUpdated(false);
    if (!currentPassword || !newPassword) return;
    if (newPassword !== confirmPassword) {
      setPasswordError(`${copy.newPassword} / ${copy.confirmNewPassword} ✗`);
      return;
    }
    setPasswordBusy(true);
    try {
      await platformApi("/api/platform/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordUpdated(true);
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : String(error));
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="settings-platform-section">
      {/* 账号 */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-ui-base font-semibold text-foreground">{copy.accountTitle}</div>
            <div className="mt-0.5 text-ui-xs text-foreground-subtle">{copy.accountDescription}</div>
          </div>
        </header>
        <div className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-ui-sm font-semibold text-foreground">
              {(platformUser.displayName || platformUser.username).slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-ui-base font-medium text-foreground">
                  {platformUser.displayName || platformUser.username}
                </span>
                <Badge variant="secondary">{roleLabel}</Badge>
                {platformUser.status === "disabled" ? (
                  <Badge variant="destructive">{copy.statusDisabled}</Badge>
                ) : null}
              </div>
              <div className="mt-0.5 text-ui-xs text-foreground-subtle">
                ID {platformUser.id.slice(0, 8)}
              </div>
            </div>
          </div>
          <div className="mt-4 max-w-md space-y-2 border-t border-border pt-4">
            <div className="text-ui-sm font-medium text-foreground">{copy.changePasswordTitle}</div>
            <Input
              size="lg"
              type="password"
              placeholder={copy.currentPassword}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            <Input
              size="lg"
              type="password"
              placeholder={copy.newPassword}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <Input
              size="lg"
              type="password"
              placeholder={copy.confirmNewPassword}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            {passwordError ? <p className="text-ui-xs text-destructive">{passwordError}</p> : null}
            {passwordUpdated ? (
              <p className="text-ui-xs text-foreground-subtle">{copy.passwordUpdated}</p>
            ) : null}
            <Button
              size="sm"
              disabled={passwordBusy || !currentPassword || !newPassword}
              onClick={() => void submitPassword()}
            >
              {passwordBusy ? copy.savingAction : copy.updatePasswordAction}
            </Button>
          </div>
        </div>
      </section>

      {/* 我的分享 */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-ui-base font-semibold text-foreground">{copy.sharesTitle}</div>
            <div className="mt-0.5 text-ui-xs text-foreground-subtle">{copy.sharesDescription}</div>
          </div>
          {hint ? <span className="text-ui-xs text-foreground-subtle">{hint}</span> : null}
        </header>
        {sharesError ? (
          <div className="border-b border-border px-4 py-2 text-ui-xs text-destructive">{sharesError}</div>
        ) : null}
        {shares === null ? (
          <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
            <Spinner className="size-5" />
          </div>
        ) : shares.length === 0 ? (
          <div className="px-4 py-8 text-center text-ui-sm text-foreground-subtle">{copy.shareEmpty}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-ui-sm">
              <thead>
                <tr className="bg-surface text-ui-xs text-foreground-subtle">
                  <th className="px-4 py-2 text-left font-medium">{copy.colTitle}</th>
                  <th className="px-3 py-2 text-left font-medium">{copy.colType}</th>
                  <th className="px-3 py-2 text-left font-medium">{copy.colVisibility}</th>
                  <th className="px-3 py-2 text-right font-medium">{copy.colViews}</th>
                  <th className="px-3 py-2 text-left font-medium">{copy.colCreated}</th>
                  <th className="px-4 py-2 text-right font-medium">{copy.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {shares.map((share) => {
                  const typeLabel =
                    share.resourceType === "session"
                      ? copy.typeSession
                      : share.resourceType === "task"
                        ? copy.typeTask
                        : copy.typeProject;
                  return (
                    <tr key={share.token} className="border-t border-border">
                      <td className="max-w-56 truncate px-4 py-2 text-foreground" title={share.title}>
                        {share.title || "—"}
                      </td>
                      <td className="px-3 py-2 text-foreground-subtle">{typeLabel}</td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          <Switch
                            size="sm"
                            checked={share.visibility === "open"}
                            disabled={busyToken === share.token || !platformUser.permissions.canSharePublicly}
                            onCheckedChange={(checked) =>
                              void patchShare(share.token, { visibility: checked ? "open" : "public" })
                            }
                          />
                          <span className="text-ui-xs text-foreground-subtle">
                            {share.visibility === "open" ? copy.visibilityOpen : copy.visibilityPublic}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground-subtle">
                        {share.viewCount}
                      </td>
                      <td className="px-3 py-2 text-foreground-subtle">
                        {formatDateTime(share.createdAt, intl.locale)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => window.open(`/s/${share.token}`, "_blank")}
                          >
                            {copy.openAction}
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => void copyShareLink(share.token)}>
                            {copy.copyLinkAction}
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={busyToken === share.token}
                            onClick={() => void patchShare(share.token, { refresh: true })}
                          >
                            {copy.refreshAction}
                          </Button>
                          {confirmToken === share.token ? (
                            <>
                              <Button
                                size="xs"
                                variant="destructive"
                                disabled={busyToken === share.token}
                                onClick={() => void deleteShare(share.token)}
                              >
                                {copy.yesAction}
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => setConfirmToken(null)}
                              >
                                {copy.cancelAction}
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="xs"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => setConfirmToken(share.token)}
                            >
                              {copy.deleteAction}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
