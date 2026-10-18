import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Badge } from "@/components/ui/badge.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { Spinner } from "@/components/ui/spinner.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { setPlatformUser, usePlatformUser } from "@/platformUserStore.js";
import {
  PlatformApiError,
  platformApi,
  platformApiDelete,
  type PlatformPromptRow,
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

/**
 * 头像选择处理（OpenWebUI UserProfileImage 同款）：FileReader 读图 → canvas
 * 居中裁剪 250×250 → webp(0.8) data-URI。服务端仅接受该四类 data-URI。
 */
async function readAvatarAsDataUri(file: File): Promise<string> {
  const allowed = ["image/gif", "image/webp", "image/jpeg", "image/png"];
  if (!allowed.includes(file.type)) {
    throw new Error("UNSUPPORTED");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("READ_FAILED"));
    reader.readAsDataURL(file);
  });
  // GIF 保持原样（canvas 会丢失动图帧）；其余类型统一裁剪压缩。
  if (file.type === "image/gif") return dataUrl;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("DECODE_FAILED"));
    img.src = dataUrl;
  });
  const size = 250;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  const scale = Math.max(size / image.width, size / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  return canvas.toDataURL("image/webp", 0.8);
}

export function PlatformSection() {
  const { intl, locale: intlLocale } = useZCodeIntl();
  const copy = getPlatformSectionCopy(intlLocale);
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

  // 个人资料编辑（OpenWebUI Account 页对应）
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [profileDirty, setProfileDirty] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSavedFlag, setProfileSavedFlag] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  useEffect(() => {
    if (!platformUser) return;
    setProfileName(platformUser.displayName ?? "");
    setProfileEmail(platformUser.email ?? "");
    setProfileBio(platformUser.bio ?? "");
    setProfileDirty(false);
  }, [platformUser]);

  const submitProfile = useCallback(
    async (avatarOverride?: string | null): Promise<void> => {
      if (!platformUser || profileBusy) return;
      setProfileBusy(true);
      setProfileError(null);
      setProfileSavedFlag(false);
      try {
        const body: Record<string, unknown> = {
          displayName: profileName,
          email: profileEmail,
          bio: profileBio,
        };
        if (avatarOverride !== undefined) body.avatarUrl = avatarOverride;
        const data = await platformApi<{ user: { displayName?: string; email?: string; bio?: string; avatarUrl?: string } }>(
          "/api/platform/auth/update-profile",
          { method: "POST", body: JSON.stringify(body) },
        );
        setPlatformUser({
          ...platformUser,
          ...(data.user.displayName ? { displayName: data.user.displayName } : { displayName: undefined }),
          ...(data.user.email ? { email: data.user.email } : { email: undefined }),
          ...(data.user.bio ? { bio: data.user.bio } : { bio: undefined }),
          ...(data.user.avatarUrl ? { avatarUrl: data.user.avatarUrl } : { avatarUrl: undefined }),
        });
        setProfileDirty(false);
        setProfileSavedFlag(true);
      } catch (error) {
        setProfileError(error instanceof Error ? error.message : String(error));
      } finally {
        setProfileBusy(false);
      }
    },
    [platformUser, profileBusy, profileName, profileEmail, profileBio],
  );

  const handleAvatarSelected = useCallback(
    async (file: File | undefined): Promise<void> => {
      if (!file || !platformUser) return;
      setProfileError(null);
      setAvatarBusy(true);
      try {
        const dataUri = await readAvatarAsDataUri(file);
        await submitProfile(dataUri);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setProfileError(
          message === "UNSUPPORTED" ? copy.avatarUnsupported : `${copy.loadFailed}: ${message}`,
        );
      } finally {
        setAvatarBusy(false);
        if (avatarInputRef.current) avatarInputRef.current.value = "";
      }
    },
    [platformUser, submitProfile, copy],
  );

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
            {/* 头像：点击上传（悬停遮罩），data-URI 直存用户表（OpenWebUI 同款无文件依赖） */}
            <button
              type="button"
              className="group relative size-14 shrink-0 overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => avatarInputRef.current?.click()}
              title={copy.avatarUpload}
            >
              {platformUser.avatarUrl ? (
                <img
                  src={platformUser.avatarUrl}
                  alt=""
                  className="size-14 rounded-lg object-cover"
                />
              ) : (
                <img
                  src={`/api/platform/users/${platformUser.id}/avatar`}
                  alt=""
                  className="size-14 rounded-lg object-cover"
                />
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-ui-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                {avatarBusy ? <Spinner className="size-4" /> : copy.avatarUpload}
              </span>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(event) => void handleAvatarSelected(event.target.files?.[0])}
            />
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
            {platformUser.avatarUrl ? (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                disabled={avatarBusy}
                onClick={() => void submitProfile(null)}
              >
                {copy.avatarRemove}
              </Button>
            ) : null}
          </div>

          {/* 个人资料编辑 */}
          <div className="mt-4 max-w-md space-y-2 border-t border-border pt-4">
            <div className="text-ui-sm font-medium text-foreground">{copy.profileTitle}</div>
            <div className="text-ui-xs text-foreground-subtle">{copy.profileDescription}</div>
            <Input
              size="lg"
              placeholder={copy.profileDisplayNamePlaceholder}
              value={profileName}
              maxLength={64}
              onChange={(event) => {
                setProfileName(event.target.value);
                setProfileDirty(true);
              }}
            />
            <Input
              size="lg"
              type="email"
              placeholder={copy.profileEmailPlaceholder}
              value={profileEmail}
              maxLength={254}
              onChange={(event) => {
                setProfileEmail(event.target.value);
                setProfileDirty(true);
              }}
            />
            <Textarea
              placeholder={copy.profileBioPlaceholder}
              value={profileBio}
              maxLength={500}
              rows={3}
              onChange={(event) => {
                setProfileBio(event.target.value);
                setProfileDirty(true);
              }}
            />
            {profileError ? <p className="text-ui-xs text-destructive">{profileError}</p> : null}
            {profileSavedFlag ? (
              <p className="text-ui-xs text-foreground-subtle">{copy.profileSaved}</p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={profileBusy || (!profileDirty && !profileSavedFlag)}
                onClick={() => void submitProfile()}
              >
                {profileBusy ? copy.savingAction : copy.profileSaveAction}
              </Button>
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
                        {formatDateTime(share.createdAt, intlLocale)}
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

      {/* 提示词库 */}
      <PromptsSection />

      {/* API 密钥 */}
      <ApiTokensSection />
    </div>
  );
}

interface PlatformApiTokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

function ApiTokensSection(): React.ReactElement {
  const { intl, locale: intlLocale } = useZCodeIntl();
  const copy = getPlatformSectionCopy(intlLocale);
  const platformUser = usePlatformUser();

  const [tokens, setTokens] = useState<PlatformApiTokenRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // 新令牌明文只在创建响应中出现一次；展示期间高亮，关闭/再建后清掉。
  const [freshToken, setFreshToken] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await platformApi<{ tokens: PlatformApiTokenRow[] }>("/api/platform/tokens");
      setTokens(data.tokens);
    } catch (requestError) {
      setTokens([]);
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }, []);

  useEffect(() => {
    if (!platformUser) return;
    void load();
  }, [platformUser, load]);

  if (!platformUser) return <></>;

  const submit = async (): Promise<void> => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const data = await platformApi<{ token: string }>("/api/platform/tokens", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setFreshToken(data.token);
      setName("");
      setHint(null);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      await platformApiDelete(`/api/platform/tokens/${id}`);
      setConfirmId(null);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusyId(null);
    }
  };

  const copyFreshToken = async (): Promise<void> => {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken);
      setHint(copy.tokenCopied);
    } catch {
      window.prompt(copy.tokenCreatedOnce, freshToken);
    }
  };

  const closeCreate = (): void => {
    setCreateOpen(false);
    setFreshToken(null);
  };

  const example = copy.apiExampleText.replaceAll("{origin}", window.location.origin);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="platform-api-tokens">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="text-ui-base font-semibold text-foreground">{copy.apiTokensTitle}</div>
          <div className="mt-0.5 text-ui-xs text-foreground-subtle">{copy.apiTokensDescription}</div>
        </div>
        <div className="flex items-center gap-3">
          {hint ? <span className="text-ui-xs text-foreground-subtle">{hint}</span> : null}
          <Button
            size="sm"
            onClick={() => {
              setFreshToken(null);
              setCreateOpen(true);
            }}
          >
            {copy.createTokenAction}
          </Button>
        </div>
      </header>
      {error ? (
        <div className="border-b border-border px-4 py-2 text-ui-xs text-destructive">{error}</div>
      ) : null}
      {createOpen ? (
        <div className="grid gap-3 border-b border-border px-4 py-4">
          {freshToken ? (
            <div className="space-y-2">
              <div className="text-ui-sm font-medium text-foreground">{copy.tokenCreatedOnce}</div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-surface px-3 py-2 font-mono text-ui-xs text-foreground">
                  {freshToken}
                </code>
                <Button size="sm" onClick={() => void copyFreshToken()}>
                  {copy.copyLinkAction}
                </Button>
                <Button size="sm" variant="ghost" onClick={closeCreate}>
                  {copy.cancelAction}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Input
                size="lg"
                placeholder={copy.tokenNameLabel}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={closeCreate}>
                  {copy.cancelAction}
                </Button>
                <Button size="sm" disabled={busy || !name.trim()} onClick={() => void submit()}>
                  {busy ? copy.savingAction : copy.createTokenAction}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
      {tokens === null ? (
        <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
          <Spinner className="size-5" />
        </div>
      ) : tokens.length === 0 ? (
        <div className="px-4 py-8 text-center text-ui-sm text-foreground-subtle">{copy.apiTokenEmpty}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-ui-sm">
            <thead>
              <tr className="bg-surface text-ui-xs text-foreground-subtle">
                <th className="px-4 py-2 text-left font-medium">{copy.colTokenName}</th>
                <th className="px-3 py-2 text-left font-medium">{copy.colTokenPrefix}</th>
                <th className="px-3 py-2 text-left font-medium">{copy.colCreated}</th>
                <th className="px-3 py-2 text-left font-medium">{copy.colLastUsed}</th>
                <th className="px-4 py-2 text-right font-medium">{copy.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium text-foreground">{token.name}</td>
                  <td className="px-3 py-2 font-mono text-ui-xs text-foreground-subtle">{token.prefix}</td>
                  <td className="px-3 py-2 text-foreground-subtle">
                    {formatDateTime(token.createdAt, intlLocale)}
                  </td>
                  <td className="px-3 py-2 text-foreground-subtle">
                    {token.lastUsedAt ? formatDateTime(token.lastUsedAt, intlLocale) : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-2">
                      {token.revokedAt ? (
                        <Badge variant="outline">{copy.tokenRevokedBadge}</Badge>
                      ) : (
                        <>
                          <Badge variant="secondary">{copy.tokenActiveBadge}</Badge>
                          {confirmId === token.id ? (
                            <>
                              <Button
                                size="xs"
                                variant="destructive"
                                disabled={busyId === token.id}
                                onClick={() => void revoke(token.id)}
                              >
                                {copy.yesAction}
                              </Button>
                              <Button size="xs" variant="ghost" onClick={() => setConfirmId(null)}>
                                {copy.cancelAction}
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="xs"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => setConfirmId(token.id)}
                            >
                              {copy.revokeTokenAction}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className="border-t border-border px-4 py-3">
        <summary className="cursor-pointer text-ui-xs text-foreground-subtle">{copy.apiExampleLabel}</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-surface px-3 py-2 font-mono text-ui-xs text-foreground-subtle">
          {example}
        </pre>
      </details>
    </section>
  );
}

function PromptsSection(): React.ReactElement {
  const { intl, locale: intlLocale } = useZCodeIntl();
  const copy = getPlatformSectionCopy(intlLocale);
  const platformUser = usePlatformUser();
  const isAdmin = platformUser?.role === "admin";

  const [prompts, setPrompts] = useState<PlatformPromptRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isGlobal, setIsGlobal] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await platformApi<{ prompts: PlatformPromptRow[] }>("/api/platform/prompts");
      setPrompts(data.prompts);
    } catch (requestError) {
      setPrompts([]);
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }, []);

  useEffect(() => {
    if (!platformUser) return;
    void load();
  }, [platformUser, load]);

  if (!platformUser) return <></>;

  const openCreate = (): void => {
    setEditingId(null);
    setTitle("");
    setContent("");
    setIsGlobal(false);
    setCreateOpen(true);
  };

  const openEdit = (prompt: PlatformPromptRow): void => {
    setEditingId(prompt.id);
    setTitle(prompt.title);
    setContent(prompt.content);
    setIsGlobal(!prompt.ownerId);
    setCreateOpen(true);
  };

  const submit = async (): Promise<void> => {
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        await platformApi(`/api/platform/prompts/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify({ title, content }),
        });
      } else {
        await platformApi("/api/platform/prompts", {
          method: "POST",
          body: JSON.stringify({ title, content, global: isGlobal && isAdmin }),
        });
      }
      setCreateOpen(false);
      setHint(copy.promptSaved);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      await platformApiDelete(`/api/platform/prompts/${id}`);
      setConfirmId(null);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusyId(null);
    }
  };

  const copyContent = async (prompt: PlatformPromptRow): Promise<void> => {
    try {
      await navigator.clipboard.writeText(prompt.content);
      setHint(copy.promptCopied);
    } catch {
      window.prompt(copy.promptTitleLabel, prompt.content);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="text-ui-base font-semibold text-foreground">{copy.promptsTitle}</div>
          <div className="mt-0.5 text-ui-xs text-foreground-subtle">{copy.promptsDescription}</div>
        </div>
        <div className="flex items-center gap-3">
          {hint ? <span className="text-ui-xs text-foreground-subtle">{hint}</span> : null}
          <Button size="sm" onClick={openCreate}>
            {copy.createPromptAction}
          </Button>
        </div>
      </header>
      {error ? (
        <div className="border-b border-border px-4 py-2 text-ui-xs text-destructive">{error}</div>
      ) : null}
      {createOpen ? (
        <div className="grid gap-3 border-b border-border px-4 py-4">
          <Input
            size="lg"
            placeholder={copy.promptTitleLabel}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Textarea
            rows={5}
            placeholder={copy.promptContentLabel}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          {isAdmin ? (
            <label className="flex items-center gap-2 text-ui-sm text-foreground-subtle">
              <Switch size="sm" checked={isGlobal} onCheckedChange={setIsGlobal} />
              {copy.promptGlobalToggle}
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(false)}>
              {copy.cancelAction}
            </Button>
            <Button size="sm" disabled={busy || !title.trim() || !content.trim()} onClick={() => void submit()}>
              {busy ? copy.savingAction : copy.saveAction}
            </Button>
          </div>
        </div>
      ) : null}
      {prompts === null ? (
        <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
          <Spinner className="size-5" />
        </div>
      ) : prompts.length === 0 ? (
        <div className="px-4 py-8 text-center text-ui-sm text-foreground-subtle">{copy.promptEmpty}</div>
      ) : (
        <div className="divide-y divide-border">
          {prompts.map((prompt) => (
            <div key={prompt.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-ui-sm font-medium text-foreground">{prompt.title}</span>
                  {!prompt.ownerId ? <Badge variant="secondary">{copy.promptGlobalBadge}</Badge> : null}
                </div>
                <div className="flex items-center gap-1">
                  <Button size="xs" variant="ghost" onClick={() => void copyContent(prompt)}>
                    {copy.copyLinkAction}
                  </Button>
                  {!prompt.ownerId || prompt.ownerId === platformUser.id || isAdmin ? (
                    <Button size="xs" variant="ghost" onClick={() => openEdit(prompt)}>
                      {copy.editAction}
                    </Button>
                  ) : null}
                  {prompt.ownerId === platformUser.id || isAdmin ? (
                    confirmId === prompt.id ? (
                      <>
                        <Button
                          size="xs"
                          variant="destructive"
                          disabled={busyId === prompt.id}
                          onClick={() => void remove(prompt.id)}
                        >
                          {copy.yesAction}
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setConfirmId(null)}>
                          {copy.cancelAction}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setConfirmId(prompt.id)}
                      >
                        {copy.deleteAction}
                      </Button>
                    )
                  ) : null}
                </div>
              </div>
              <pre className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface px-3 py-2 text-ui-xs text-foreground-subtle">
                {prompt.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
