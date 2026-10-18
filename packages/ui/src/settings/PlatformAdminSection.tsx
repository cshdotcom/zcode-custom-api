/* eslint-disable max-lines -- 平台管理控制台（用户/邀请码/用户组/系统/搜索/浏览器桥）六个业务页签同属一个原生分区，拆文件反而割裂上下文。 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Badge } from "@/components/ui/badge.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { Spinner } from "@/components/ui/spinner.js";
import { Textarea } from "@/components/ui/textarea.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { usePlatformUser } from "@/platformUserStore.js";
import { SettingsSegmentedTabs } from "./SettingsSegmentedTabs.js";
import {
  PlatformApiError,
  platformApi,
  platformApiDelete,
  type PlatformBrowserStatus,
  type PlatformEventRow,
  type PlatformGroupRow,
  type PlatformInviteRow,
  type PlatformKbDocRow,
  type PlatformSearchConfig,
  type PlatformStatsRow,
  type PlatformSystemConfig,
  type PlatformUserRow,
} from "./platformApi.js";
import { getPlatformAdminSectionCopy, platformEventLabel } from "./platformLocale.js";

/**
 * 设置页「平台管理」分区（仅管理员可见）：
 * 用户 / 邀请码 / 用户组 / 系统设置 / 联网搜索 / 浏览器桥。
 * 这是原独立管理控制台（/platform/admin 手写页）的原生融合版本：
 * 与其他官方设置分区共用同一套侧栏、卡片、表格与原语。
 */

type AdminTab = "users" | "invites" | "groups" | "knowledge" | "usage" | "system" | "search" | "browser";

function formatDateTime(value: number | undefined, locale: string): string {
  if (!value) return "—";
  try {
    return new Date(Number(value)).toLocaleString(locale.startsWith("zh") ? "zh-CN" : "en-US");
  } catch {
    return "—";
  }
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof PlatformApiError) return error.message;
  return error instanceof Error ? `${fallback}: ${error.message}` : `${fallback}: ${String(error)}`;
}

function Card({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="text-ui-base font-semibold text-foreground">{title}</div>
          {description ? (
            <div className="mt-0.5 text-ui-xs text-foreground-subtle">{description}</div>
          ) : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ui-xs font-medium text-foreground-subtle">{label}</span>
      {children}
    </label>
  );
}

// ---------------- 用户 ----------------

function UsersTab(): React.ReactElement {
  const { intl, locale: intlLocale } = useZCodeIntl();
  const copy = getPlatformAdminSectionCopy(intlLocale);
  const me = usePlatformUser();
  const [users, setUsers] = useState<PlatformUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin" | "pending">("user");
  const [createBusy, setCreateBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const usersData = await platformApi<{ users: PlatformUserRow[] }>(
        "/api/platform/admin/users",
      );
      setUsers(usersData.users);
    } catch (requestError) {
      setUsers([]);
      setError(errorText(requestError, copy.loadFailed));
    }
  }, [copy.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, body: Record<string, unknown>): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      await platformApi(`/api/platform/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await load();
    } catch (requestError) {
      setError(errorText(requestError, copy.loadFailed));
    } finally {
      setBusyId(null);
    }
  };

  const removeUser = async (id: string): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      await platformApiDelete(`/api/platform/admin/users/${id}`);
      setConfirmId(null);
      await load();
    } catch (requestError) {
      setError(errorText(requestError, copy.loadFailed));
    } finally {
      setBusyId(null);
    }
  };

  const createUser = async (): Promise<void> => {
    if (!newUsername.trim() || !newPassword) return;
    setCreateBusy(true);
    setError(null);
    try {
      await platformApi("/api/platform/admin/users", {
        method: "POST",
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, role: newRole }),
      });
      setNewUsername("");
      setNewPassword("");
      setNewRole("user");
      setCreateOpen(false);
      await load();
    } catch (requestError) {
      setError(errorText(requestError, copy.loadFailed));
    } finally {
      setCreateBusy(false);
    }
  };

  const resetPassword = async (id: string): Promise<void> => {
    const nextPassword = window.prompt(copy.newUserPasswordPrompt);
    if (!nextPassword) return;
    await act(id, { action: "resetPassword", password: nextPassword });
  };

  return (
    <Card
      title={copy.usersTitle}
      description={copy.usersDescription}
      action={
        <Button size="sm" variant="outline" onClick={() => setCreateOpen((open) => !open)}>
          {copy.createUserAction}
        </Button>
      }
    >
      {createOpen ? (
        <div className="grid gap-2 border-b border-border bg-surface px-4 py-3 sm:grid-cols-4">
          <Field label={copy.createUsername}>
            <Input size="lg" value={newUsername} onChange={(event) => setNewUsername(event.target.value)} />
          </Field>
          <Field label={copy.createPassword}>
            <Input
              size="lg"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
          <Field label={copy.createRole}>
            <Select value={newRole} onValueChange={(next) => setNewRole(next as typeof newRole)}>
              <SelectTrigger size="lg" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">{copy.roleUser}</SelectItem>
                <SelectItem value="admin">{copy.roleAdmin}</SelectItem>
                <SelectItem value="pending">{copy.rolePending}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button size="lg" className="w-full" disabled={createBusy || !newUsername.trim() || !newPassword} onClick={() => void createUser()}>
              {createBusy ? copy.savingAction : copy.createUserAction}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="border-b border-border px-4 py-2 text-ui-xs text-destructive">{error}</div>
      ) : null}
      {users === null ? (
        <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
          <Spinner className="size-5" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-ui-sm">
            <thead>
              <tr className="bg-surface text-ui-xs text-foreground-subtle">
                <th className="px-4 py-2 text-left font-medium">{copy.colUsername}</th>
                <th className="px-3 py-2 text-left font-medium">{copy.colRole}</th>
                <th className="px-3 py-2 text-left font-medium">{copy.colStatus}</th>
                <th className="px-3 py-2 text-left font-medium">{copy.colGroups}</th>
                <th className="px-3 py-2 text-left font-medium">{copy.colCreated}</th>
                <th className="px-3 py-2 text-left font-medium">{copy.colLastLogin}</th>
                <th className="px-4 py-2 text-right font-medium">{copy.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium text-foreground">
                    {user.username}
                    {me?.id === user.id ? (
                      <span className="ml-1 text-ui-xs text-foreground-subtle">{copy.youLabel}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={user.role === "admin" ? "default" : user.role === "pending" ? "outline" : "secondary"}>
                      {user.role === "admin" ? copy.roleAdmin : user.role === "pending" ? copy.rolePending : copy.roleUser}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {user.status === "active" ? (
                      <span className="text-ui-xs text-foreground-subtle">{copy.statusActive}</span>
                    ) : (
                      <Badge variant="destructive">{copy.statusDisabled}</Badge>
                    )}
                  </td>
                  <td className="max-w-40 truncate px-3 py-2 text-ui-xs text-foreground-subtle" title={user.groupNames.join(", ")}>
                    {user.groupNames.length > 0 ? user.groupNames.join(", ") : copy.noGroups}
                  </td>
                  <td className="px-3 py-2 text-ui-xs text-foreground-subtle">
                    {formatDateTime(user.createdAt, intlLocale)}
                  </td>
                  <td className="px-3 py-2 text-ui-xs text-foreground-subtle">
                    {formatDateTime(user.lastLoginAt, intlLocale)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {user.role === "pending" ? (
                        <Button size="xs" variant="ghost" disabled={busyId === user.id} onClick={() => void act(user.id, { action: "approve" })}>
                          {copy.actionApprove}
                        </Button>
                      ) : null}
                      {user.role !== "admin" ? (
                        <Button size="xs" variant="ghost" disabled={busyId === user.id} onClick={() => void act(user.id, { action: "makeAdmin" })}>
                          {copy.actionMakeAdmin}
                        </Button>
                      ) : (
                        me?.id !== user.id && (
                          <Button size="xs" variant="ghost" disabled={busyId === user.id} onClick={() => void act(user.id, { action: "makeUser" })}>
                            {copy.actionMakeUser}
                          </Button>
                        )
                      )}
                      {user.status === "active" ? (
                        me?.id !== user.id && (
                          <Button size="xs" variant="ghost" disabled={busyId === user.id} onClick={() => void act(user.id, { action: "disable" })}>
                            {copy.actionDisable}
                          </Button>
                        )
                      ) : (
                        <Button size="xs" variant="ghost" disabled={busyId === user.id} onClick={() => void act(user.id, { action: "enable" })}>
                          {copy.actionEnable}
                        </Button>
                      )}
                      <Button size="xs" variant="ghost" disabled={busyId === user.id} onClick={() => void resetPassword(user.id)}>
                        {copy.actionResetPassword}
                      </Button>
                      {me?.id !== user.id ? (
                        confirmId === user.id ? (
                          <>
                            <Button size="xs" variant="destructive" disabled={busyId === user.id} onClick={() => void removeUser(user.id)}>
                              {copy.yesAction}
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => setConfirmId(null)}>
                              {copy.cancelAction}
                            </Button>
                          </>
                        ) : (
                          <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setConfirmId(user.id)}>
                            {copy.actionDelete}
                          </Button>
                        )
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------- 邀请码 ----------------

function InvitesTab(): React.ReactElement {
  const { intl, locale: intlLocale } = useZCodeIntl();
  const copy = getPlatformAdminSectionCopy(intlLocale);
  const [invites, setInvites] = useState<PlatformInviteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [maxUses, setMaxUses] = useState("0");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [defaultRole, setDefaultRole] = useState<"user" | "pending">("user");
  const [note, setNote] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const data = await platformApi<{ invites: PlatformInviteRow[] }>("/api/platform/admin/invites");
      setInvites(data.invites);
    } catch (requestError) {
      setInvites([]);
      setError(errorText(requestError, copy.loadFailed));
    }
  }, [copy.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (): Promise<void> => {
    setCreateBusy(true);
    setError(null);
    try {
      await platformApi("/api/platform/admin/invites", {
        method: "POST",
        body: JSON.stringify({
          maxUses: Number(maxUses) || 0,
          expiresInDays: Number(expiresInDays) || 0,
          defaultRole,
          note,
        }),
      });
      setNote("");
      await load();
    } catch (requestError) {
      setError(errorText(requestError, copy.loadFailed));
    } finally {
      setCreateBusy(false);
    }
  };

  const setStatus = async (code: string, disabled: boolean): Promise<void> => {
    setBusyCode(code);
    setError(null);
    try {
      await platformApi(`/api/platform/admin/invites/${code}`, {
        method: "PATCH",
        body: JSON.stringify({ disabled }),
      });
      await load();
    } catch (requestError) {
      setError(errorText(requestError, copy.loadFailed));
    } finally {
      setBusyCode(null);
    }
  };

  const remove = async (code: string): Promise<void> => {
    setBusyCode(code);
    setError(null);
    try {
      await platformApiDelete(`/api/platform/admin/invites/${code}`);
      await load();
    } catch (requestError) {
      setError(errorText(requestError, copy.loadFailed));
    } finally {
      setBusyCode(null);
    }
  };

  const statusOf = (invite: PlatformInviteRow): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } => {
    if (invite.disabled) return { label: copy.inviteStatusDisabled, variant: "destructive" };
    if (invite.expiresAt && Date.now() > Number(invite.expiresAt)) {
      return { label: copy.inviteStatusExpired, variant: "outline" };
    }
    if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
      return { label: copy.inviteStatusExhausted, variant: "outline" };
    }
    return { label: copy.inviteStatusActive, variant: "secondary" };
  };

  return (
    <Card title={copy.invitesTitle} description={copy.invitesDescription}>
      <div className="grid gap-2 border-b border-border bg-surface px-4 py-3 sm:grid-cols-5">
        <Field label={copy.inviteMaxUses}>
          <Input size="lg" inputMode="numeric" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} />
        </Field>
        <Field label={copy.inviteExpiresDays}>
          <Input size="lg" inputMode="numeric" value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)} />
        </Field>
        <Field label={copy.inviteDefaultRole}>
          <Select value={defaultRole} onValueChange={(next) => setDefaultRole(next as typeof defaultRole)}>
            <SelectTrigger size="lg" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">{copy.roleUser}</SelectItem>
              <SelectItem value="pending">{copy.rolePending}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={copy.inviteNote}>
          <Input size="lg" value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button size="lg" className="w-full" disabled={createBusy} onClick={() => void create()}>
            {createBusy ? copy.savingAction : copy.createInviteAction}
          </Button>
        </div>
      </div>
      {error ? (
        <div className="border-b border-border px-4 py-2 text-ui-xs text-destructive">{error}</div>
      ) : null}
      {invites === null ? (
        <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
          <Spinner className="size-5" />
        </div>
      ) : invites.length === 0 ? (
        <div className="px-4 py-8 text-center text-ui-sm text-foreground-subtle">{copy.inviteEmpty}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-ui-sm">
            <thead>
              <tr className="bg-surface text-ui-xs text-foreground-subtle">
                <th className="px-4 py-2 text-left font-medium">{copy.inviteCodeCol}</th>
                <th className="px-3 py-2 text-left font-medium">{copy.inviteUsesCol}</th>
                <th className="px-3 py-2 text-left font-medium">{copy.inviteDefaultRole}</th>
                <th className="px-3 py-2 text-left font-medium">{copy.inviteExpiresCol}</th>
                <th className="px-3 py-2 text-left font-medium">{copy.inviteStatusCol}</th>
                <th className="px-3 py-2 text-left font-medium">{copy.inviteNote}</th>
                <th className="px-4 py-2 text-right font-medium">{copy.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => {
                const status = statusOf(invite);
                return (
                  <tr key={invite.code} className="border-t border-border">
                    <td className="px-4 py-2">
                      <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-ui-xs text-foreground">
                        {invite.code}
                      </code>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-foreground-subtle">
                      {invite.uses} / {invite.maxUses > 0 ? invite.maxUses : copy.inviteUnlimited}
                    </td>
                    <td className="px-3 py-2 text-foreground-subtle">
                      {invite.defaultRole === "pending" ? copy.rolePending : copy.roleUser}
                    </td>
                    <td className="px-3 py-2 text-ui-xs text-foreground-subtle">
                      {invite.expiresAt ? formatDateTime(invite.expiresAt, intlLocale) : copy.inviteNeverExpires}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                    <td className="max-w-32 truncate px-3 py-2 text-ui-xs text-foreground-subtle" title={invite.note}>
                      {invite.note || "—"}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => void navigator.clipboard.writeText(invite.code).catch(() => undefined)}
                        >
                          {copy.inviteCopyAction}
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busyCode === invite.code}
                          onClick={() => void setStatus(invite.code, !invite.disabled)}
                        >
                          {invite.disabled ? copy.actionEnable : copy.actionDisable}
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-destructive"
                          disabled={busyCode === invite.code}
                          onClick={() => void remove(invite.code)}
                        >
                          {copy.actionDelete}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------- 用户组 ----------------

function GroupsTab(): React.ReactElement {
  const { intl, locale: intlLocale } = useZCodeIntl();
  const copy = getPlatformAdminSectionCopy(intlLocale);
  const [groups, setGroups] = useState<PlatformGroupRow[] | null>(null);
  const [users, setUsers] = useState<PlatformUserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [groupsData, usersData] = await Promise.all([
        platformApi<{ groups: PlatformGroupRow[] }>("/api/platform/groups"),
        platformApi<{ users: PlatformUserRow[] }>("/api/platform/admin/users"),
      ]);
      setGroups(groupsData.groups);
      setUsers(usersData.users);
    } catch (requestError) {
      setGroups([]);
      setError(errorText(requestError, copy.loadFailed));
    }
  }, [copy.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (): Promise<void> => {
    if (!name.trim()) return;
    setCreateBusy(true);
    setError(null);
    try {
      await platformApi("/api/platform/admin/groups", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          permissions: { "chat.share": true },
        }),
      });
      setName("");
      setDescription("");
      await load();
    } catch (requestError) {
      setError(errorText(requestError, copy.loadFailed));
    } finally {
      setCreateBusy(false);
    }
  };

  const patchGroup = async (id: string, body: Record<string, unknown>): Promise<void> => {
    setError(null);
    try {
      await platformApi(`/api/platform/admin/groups/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await load();
    } catch (requestError) {
      setError(errorText(requestError, copy.loadFailed));
    }
  };

  const remove = async (id: string): Promise<void> => {
    setError(null);
    try {
      await platformApiDelete(`/api/platform/admin/groups/${id}`);
      await load();
    } catch (requestError) {
      setError(errorText(requestError, copy.loadFailed));
    }
  };

  return (
    <Card title={copy.groupsTitle} description={copy.groupsDescription}>
      <div className="grid gap-2 border-b border-border bg-surface px-4 py-3 sm:grid-cols-3">
        <Field label={copy.groupNameLabel}>
          <Input size="lg" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={copy.groupDescriptionLabel}>
          <Input size="lg" value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button size="lg" className="w-full" disabled={createBusy || !name.trim()} onClick={() => void create()}>
            {createBusy ? copy.savingAction : copy.createGroupAction}
          </Button>
        </div>
      </div>
      {error ? (
        <div className="border-b border-border px-4 py-2 text-ui-xs text-destructive">{error}</div>
      ) : null}
      {groups === null ? (
        <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
          <Spinner className="size-5" />
        </div>
      ) : groups.length === 0 ? (
        <div className="px-4 py-8 text-center text-ui-sm text-foreground-subtle">{copy.groupEmpty}</div>
      ) : (
        <div className="divide-y divide-border">
          {groups.map((group) => {
            const memberNameById = new Map(users.map((user) => [user.id, user.username]));
            const editing = editingId === group.id;
            return (
              <div key={group.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-ui-base font-medium text-foreground">{group.name}</span>
                      <Badge variant="secondary">
                        {group.memberIds.length} {copy.groupMembersLabel}
                      </Badge>
                    </div>
                    {group.description ? (
                      <div className="mt-0.5 text-ui-xs text-foreground-subtle">{group.description}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setEditingId(editing ? null : group.id)}>
                      {editing ? copy.cancelAction : copy.groupMembersLabel}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => void remove(group.id)}
                    >
                      {copy.actionDelete}
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                  <label className="flex items-center gap-2">
                    <Switch
                      size="sm"
                      checked={Boolean(group.permissions["chat.share"])}
                      onCheckedChange={(checked) => void patchGroup(group.id, { permissions: { "chat.share": checked } })}
                    />
                    <span className="text-ui-xs text-foreground-subtle">{copy.permChatShare}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <Switch
                      size="sm"
                      checked={Boolean(group.permissions["sharing.public"])}
                      onCheckedChange={(checked) =>
                        void patchGroup(group.id, { permissions: { "sharing.public": checked } })
                      }
                    />
                    <span className="text-ui-xs text-foreground-subtle">{copy.permSharingPublic}</span>
                  </label>
                </div>
                {editing ? (
                  <div className="mt-3 rounded-lg border border-border bg-surface p-3">
                    <div className="mb-2 text-ui-xs font-medium text-foreground-subtle">
                      {copy.groupMembersLabel}
                    </div>
                    <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                      {users.map((user) => {
                        const checked = group.memberIds.includes(user.id);
                        return (
                          <label key={user.id} className="flex items-center gap-2 text-ui-sm text-foreground">
                            <input
                              type="checkbox"
                              className="size-3.5 accent-current"
                              checked={checked}
                              onChange={(event) => {
                                const next = event.target.checked
                                  ? [...group.memberIds, user.id]
                                  : group.memberIds.filter((memberId) => memberId !== user.id);
                                void patchGroup(group.id, { memberIds: next });
                              }}
                            />
                            <span className="truncate">
                              {memberNameById.get(user.id) ?? user.id.slice(0, 8)}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ---------------- 系统设置 ----------------

function SystemTab(): React.ReactElement {
  const { intl, locale: intlLocale } = useZCodeIntl();
  const copy = getPlatformAdminSectionCopy(intlLocale);
  const [config, setConfig] = useState<PlatformSystemConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setConfig(await platformApi<PlatformSystemConfig>("/api/platform/admin/config"));
      } catch (requestError) {
        setError(errorText(requestError, copy.loadFailed));
      }
    })();
  }, [copy.loadFailed]);

  const save = async (): Promise<void> => {
    if (!config) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await platformApi<PlatformSystemConfig>("/api/platform/admin/config", {
        method: "PUT",
        body: JSON.stringify(config),
      });
      setConfig(next);
      setSaved(true);
    } catch (requestError) {
      setError(errorText(requestError, copy.loadFailed));
    } finally {
      setBusy(false);
    }
  };

  if (!config) {
    return (
      <Card title={copy.systemTitle} description={copy.systemDescription}>
        {error ? <div className="px-4 py-3 text-ui-xs text-destructive">{error}</div> : null}
        <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
          <Spinner className="size-5" />
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={copy.systemTitle}
      description={copy.systemDescription}
      action={saved ? <span className="text-ui-xs text-foreground-subtle">{copy.configSaved}</span> : null}
    >
      <div className="space-y-4 px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-ui-base text-foreground">{copy.configEnableSignup}</span>
          <Switch
            checked={config.enableSignup}
            onCheckedChange={(checked) => setConfig({ ...config, enableSignup: checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <span className="text-ui-base text-foreground">{copy.configRequireInvite}</span>
          <Switch
            checked={config.requireInvite}
            onCheckedChange={(checked) => setConfig({ ...config, requireInvite: checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <span className="text-ui-base text-foreground">{copy.configDefaultRole}</span>
          <Select
            value={config.defaultRole}
            onValueChange={(next) => setConfig({ ...config, defaultRole: next as PlatformSystemConfig["defaultRole"] })}
          >
            <SelectTrigger size="lg" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">{copy.roleUser}</SelectItem>
              <SelectItem value="pending">{copy.rolePending}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-3 border-t border-border pt-4">
          <Field label={copy.configLoginNotice}>
            <Textarea
              rows={2}
              value={config.loginNotice}
              onChange={(event) => setConfig({ ...config, loginNotice: event.target.value })}
            />
          </Field>
          <Field label={copy.configPendingNotice}>
            <Textarea
              rows={2}
              value={config.pendingNotice}
              onChange={(event) => setConfig({ ...config, pendingNotice: event.target.value })}
            />
          </Field>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <span className="text-ui-base text-foreground">{copy.configAnnouncementEnabled}</span>
            <Switch
              checked={config.announcementEnabled}
              onCheckedChange={(checked) => setConfig({ ...config, announcementEnabled: checked })}
            />
          </div>
          {config.announcementEnabled ? (
            <div className="grid gap-3 border-t border-border pt-4">
              <Field label={copy.configAnnouncementTitle}>
                <Input
                  value={config.announcementTitle}
                  onChange={(event) => setConfig({ ...config, announcementTitle: event.target.value })}
                />
              </Field>
              <Field label={copy.configAnnouncementBody}>
                <Textarea
                  rows={2}
                  value={config.announcementBody}
                  onChange={(event) => setConfig({ ...config, announcementBody: event.target.value })}
                />
              </Field>
            </div>
          ) : null}
          {/* 个人 API 网关（OpenAI 兼容端点上游） */}
          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <div className="min-w-0">
              <div className="text-ui-base text-foreground">{copy.gatewayTitle}</div>
              <div className="mt-0.5 text-ui-xs text-foreground-subtle">{copy.gatewayDescription}</div>
            </div>
            <Switch
              checked={config.gatewayEnabled}
              onCheckedChange={(checked) => setConfig({ ...config, gatewayEnabled: checked })}
            />
          </div>
          {config.gatewayEnabled ? (
            <div className="grid gap-3 border-t border-border pt-4">
              <Field label={copy.gatewayBaseUrlLabel}>
                <Input
                  placeholder="https://api.openai.com/v1"
                  value={config.gatewayBaseUrl}
                  onChange={(event) => setConfig({ ...config, gatewayBaseUrl: event.target.value })}
                />
              </Field>
              <Field label={copy.gatewayApiKeyLabel}>
                <Input
                  type="password"
                  value={config.gatewayApiKey}
                  onChange={(event) => setConfig({ ...config, gatewayApiKey: event.target.value })}
                />
              </Field>
              <Field label={copy.gatewayModelsLabel}>
                <Input
                  placeholder="gpt-4o, claude-sonnet-4-5, …"
                  value={config.gatewayModels}
                  onChange={(event) => setConfig({ ...config, gatewayModels: event.target.value })}
                />
              </Field>
            </div>
          ) : null}
        </div>
        {error ? <p className="text-ui-xs text-destructive">{error}</p> : null}
        <div className="flex justify-end border-t border-border pt-3">
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? copy.savingAction : copy.saveAction}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------- 联网搜索 ----------------

function SearchTab(): React.ReactElement {
  const { intl, locale: intlLocale } = useZCodeIntl();
  const copy = getPlatformAdminSectionCopy(intlLocale);
  const [config, setConfig] = useState<PlatformSearchConfig | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [configData, providersData] = await Promise.all([
          platformApi<PlatformSearchConfig>("/api/platform/search/config"),
          platformApi<{ providers: Array<{ id: string }> | string[] }>("/api/platform/search/providers"),
        ]);
        setConfig(configData);
        setProviders(providersData.providers.map((provider) => (typeof provider === "string" ? provider : provider.id)));
      } catch (requestError) {
        setError(errorText(requestError, copy.loadFailed));
      }
    })();
  }, [copy.loadFailed]);

  const save = async (): Promise<void> => {
    if (!config) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await platformApi<PlatformSearchConfig>("/api/platform/search/config", {
        method: "PUT",
        body: JSON.stringify(config),
      });
      setConfig(next);
      setSaved(true);
    } catch (requestError) {
      setError(errorText(requestError, copy.loadFailed));
    } finally {
      setBusy(false);
    }
  };

  if (!config) {
    return (
      <Card title={copy.searchTitle} description={copy.searchDescription}>
        {error ? <div className="px-4 py-3 text-ui-xs text-destructive">{error}</div> : null}
        <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
          <Spinner className="size-5" />
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={copy.searchTitle}
      description={copy.searchDescription}
      action={saved ? <span className="text-ui-xs text-foreground-subtle">{copy.searchSaved}</span> : null}
    >
      <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
        <Field label={copy.searchProvider}>
          <Select value={config.provider} onValueChange={(next) => setConfig({ ...config, provider: next })}>
            <SelectTrigger size="lg" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providers.map((provider) => (
                <SelectItem key={provider} value={provider}>
                  {provider}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={copy.searchApiKey}>
          <Input
            size="lg"
            type="password"
            value={config.apiKey ?? ""}
            placeholder="(unchanged)"
            onChange={(event) => setConfig({ ...config, apiKey: event.target.value })}
          />
        </Field>
        <Field label={copy.searchBaseUrl}>
          <Input
            size="lg"
            value={config.baseUrl ?? ""}
            onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })}
          />
        </Field>
        <Field label={copy.searchCount}>
          <Input
            size="lg"
            inputMode="numeric"
            value={String(config.count)}
            onChange={(event) => setConfig({ ...config, count: Number(event.target.value) || 0 })}
          />
        </Field>
        <Field label={copy.searchApiToken}>
          <Input
            size="lg"
            value={config.apiToken ?? ""}
            onChange={(event) => setConfig({ ...config, apiToken: event.target.value })}
          />
        </Field>
      </div>
      {error ? <div className="px-4 pb-2 text-ui-xs text-destructive">{error}</div> : null}
      <div className="flex justify-end border-t border-border px-4 py-3">
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? copy.savingAction : copy.saveAction}
        </Button>
      </div>
    </Card>
  );
}

// ---------------- 浏览器桥 ----------------

function BrowserTab(): React.ReactElement {
  const { intl, locale: intlLocale } = useZCodeIntl();
  const copy = getPlatformAdminSectionCopy(intlLocale);
  const [status, setStatus] = useState<PlatformBrowserStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);

  const load = useCallback(async (probe: boolean): Promise<void> => {
    setError(null);
    if (probe) setProbing(true);
    try {
      setStatus(
        await platformApi<PlatformBrowserStatus>(`/api/platform/browser/status${probe ? "?probe=1" : ""}`),
      );
    } catch (requestError) {
      setError(errorText(requestError, copy.loadFailed));
    } finally {
      setProbing(false);
    }
  }, [copy.loadFailed]);

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <Card
      title={copy.browserTitle}
      description={copy.browserDescription}
      action={
        status?.enabled ? (
          <Button size="sm" variant="outline" disabled={probing} onClick={() => void load(true)}>
            {copy.browserProbeAction}
          </Button>
        ) : undefined
      }
    >
      {error ? <div className="border-b border-border px-4 py-2 text-ui-xs text-destructive">{error}</div> : null}
      {status === null ? (
        <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
          <Spinner className="size-5" />
        </div>
      ) : !status.enabled ? (
        <div className="px-4 py-6 text-ui-sm text-foreground-subtle">{copy.browserDisabled}</div>
      ) : (
        <div className="space-y-3 px-4 py-4 text-ui-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-foreground-subtle">{copy.browserEndpoint}</span>
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-ui-xs text-foreground">
              {status.endpoint ?? "—"}
            </code>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-foreground-subtle">{copy.browserMode}</span>
            <span className="text-foreground">{status.mode ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-foreground-subtle">{copy.statusActive}</span>
            <Badge variant={status.connected ? "secondary" : "outline"}>
              {status.connected ? copy.browserConnected : copy.browserDisconnected}
            </Badge>
          </div>
        </div>
      )}
      <div className="px-4 pb-3 text-ui-xs text-foreground-subtle">
        {formatDateTime(Date.now(), intlLocale)}
      </div>
    </Card>
  );
}

// ---------------- 分区入口 ----------------

// ---------------- 知识库 ----------------

function KnowledgeTab(): React.ReactElement {
  const { intl, locale: intlLocale } = useZCodeIntl();
  const copy = getPlatformAdminSectionCopy(intlLocale);
  const [docs, setDocs] = useState<PlatformKbDocRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await platformApi<{ docs: PlatformKbDocRow[] }>("/api/platform/kb");
      setDocs(data.docs);
    } catch (requestError) {
      setDocs([]);
      setError(errorText(requestError, copy.loadFailed));
    }
  }, [copy.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (): Promise<void> => {
    setCreateBusy(true);
    setError(null);
    setHint(null);
    try {
      await platformApi("/api/platform/kb", {
        method: "POST",
        body: JSON.stringify({
          title,
          ...(filename.trim() ? { filename: filename.trim() } : {}),
          content,
        }),
      });
      setTitle("");
      setFilename("");
      setContent("");
      setHint(copy.kbUploaded);
      await load();
    } catch (requestError) {
      setError(errorText(requestError, copy.loadFailed));
    } finally {
      setCreateBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      await platformApiDelete(`/api/platform/kb/${id}`);
      await load();
    } catch (requestError) {
      setError(errorText(requestError, copy.loadFailed));
    } finally {
      setBusyId(null);
    }
  };

  const onPickFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const text = await file.text();
      setTitle((prev) => prev || file.name.replace(/\.[^.]+$/, ""));
      setFilename(file.name);
      setContent(text);
    } catch {
      setError(copy.loadFailed);
    }
  };

  return (
    <div className="space-y-4">
      <Card title={copy.kbTitle} description={copy.kbDescription}>
        <div className="grid gap-3 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={copy.kbDocTitleLabel}>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label={copy.kbFilenameLabel}>
              <Input
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
                placeholder="manual.md"
              />
            </Field>
          </div>
          <Field label={copy.kbContentLabel}>
            <Textarea
              rows={6}
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </Field>
          <p className="text-ui-xs text-foreground-subtle">{copy.kbContentHint}</p>
          <input
            type="file"
            accept=".txt,.md,.markdown,.json,.csv,.log,.xml,.yml,.yaml,.html,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.sql,.sh,text/*"
            className="text-ui-xs text-foreground-subtle file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-ui-xs file:text-foreground"
            onChange={(event) => void onPickFile(event.target.files?.[0])}
          />
          {error ? <p className="text-ui-xs text-destructive">{error}</p> : null}
          {hint ? <p className="text-ui-xs text-foreground-subtle">{hint}</p> : null}
          <div className="flex justify-end border-t border-border pt-3">
            <Button
              size="sm"
              disabled={createBusy || !title.trim() || !content.trim()}
              onClick={() => void create()}
            >
              {createBusy ? copy.savingAction : copy.kbUploadAction}
            </Button>
          </div>
        </div>
      </Card>
      <Card title={copy.kbTitle} description={undefined}>
        {docs === null ? (
          <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
            <Spinner className="size-5" />
          </div>
        ) : docs.length === 0 ? (
          <div className="px-4 py-6 text-center text-ui-sm text-foreground-subtle">{copy.kbEmpty}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-ui-sm">
              <thead>
                <tr className="text-left text-ui-xs text-foreground-subtle">
                  <th className="px-4 py-2 font-medium">{copy.colTitle}</th>
                  <th className="px-3 py-2 font-medium">{copy.colSize}</th>
                  <th className="px-3 py-2 font-medium">{copy.colChunks}</th>
                  <th className="px-3 py-2 font-medium">{copy.colCreated}</th>
                  <th className="px-4 py-2 text-right font-medium">{copy.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => (
                  <tr key={doc.id} className="border-t border-border">
                    <td className="max-w-64 truncate px-4 py-2" title={doc.filename || doc.title}>
                      {doc.title}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-foreground-subtle">
                      {(doc.size / 1024).toFixed(1)} KB
                    </td>
                    <td className="px-3 py-2 tabular-nums text-foreground-subtle">{doc.chunkCount}</td>
                    <td className="px-3 py-2 text-ui-xs text-foreground-subtle">
                      {formatDateTime(doc.createdAt, intlLocale)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end">
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-destructive"
                          disabled={busyId === doc.id}
                          onClick={() => {
                            if (window.confirm(copy.kbDeleteConfirm)) void remove(doc.id);
                          }}
                        >
                          {copy.actionDelete}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------- 用量统计与审计日志 ----------------

const AUDIT_EVENT_TYPES = [
  "auth.login",
  "auth.login_failed",
  "auth.register",
  "auth.logout",
  "share.create",
  "search.query",
  "prompt.create",
  "kb.create",
  "kb.delete",
] as const;

function UsageTab(): React.ReactElement {
  const { intl, locale: intlLocale } = useZCodeIntl();
  const copy = getPlatformAdminSectionCopy(intlLocale);
  const [stats, setStats] = useState<PlatformStatsRow | null>(null);
  const [events, setEvents] = useState<PlatformEventRow[] | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [statsData, eventsData] = await Promise.all([
          platformApi<PlatformStatsRow>("/api/platform/admin/stats"),
          platformApi<{ events: PlatformEventRow[] }>(
            typeFilter
              ? `/api/platform/admin/events?type=${encodeURIComponent(typeFilter)}&limit=200`
              : "/api/platform/admin/events?limit=200",
          ),
        ]);
        setStats(statsData);
        setEvents(eventsData.events);
      } catch (requestError) {
        setError(errorText(requestError, copy.loadFailed));
      }
    })();
  }, [typeFilter, copy.loadFailed]);

  const cards: Array<{ label: string; value: number }> = stats
    ? [
        { label: copy.statUsers, value: stats.users },
        { label: copy.statPending, value: stats.pendingUsers },
        { label: copy.statSessions, value: stats.activeSessions },
        { label: copy.statLogins24h, value: stats.logins24h },
        { label: copy.statSearches24h, value: stats.searches24h },
        { label: copy.statShares, value: stats.shares },
        { label: copy.statPrompts, value: stats.prompts },
        { label: copy.statKbDocs, value: stats.kbDocs },
      ]
    : [];

  return (
    <div className="space-y-4">
      <Card title={copy.usageTitle} description={copy.usageDescription}>
        {stats === null ? (
          <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
            <Spinner className="size-5" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4">
            {cards.map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-border bg-surface px-4 py-3"
              >
                <div className="text-ui-xs text-foreground-subtle">{card.label}</div>
                <div className="mt-1 text-ui-xl font-semibold tabular-nums text-foreground">{card.value}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card
        title={copy.auditTitle}
        description={copy.auditDescription}
        action={
          <Select value={typeFilter || "__all__"} onValueChange={(next) => setTypeFilter(next === "__all__" ? "" : next)}>
            <SelectTrigger size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{copy.auditFilterAll}</SelectItem>
              {AUDIT_EVENT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {platformEventLabel(type, intlLocale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        {error ? <div className="px-4 py-3 text-ui-xs text-destructive">{error}</div> : null}
        {events === null ? (
          <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
            <Spinner className="size-5" />
          </div>
        ) : events.length === 0 ? (
          <div className="px-4 py-6 text-center text-ui-sm text-foreground-subtle">{copy.auditEmpty}</div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-ui-sm">
              <thead>
                <tr className="text-left text-ui-xs text-foreground-subtle">
                  <th className="px-4 py-2 font-medium">{copy.colEvent}</th>
                  <th className="px-3 py-2 font-medium">{copy.colUsername}</th>
                  <th className="px-3 py-2 font-medium">{copy.colDetail}</th>
                  <th className="px-4 py-2 font-medium">{copy.colCreated}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-t border-border">
                    <td className="px-4 py-2 whitespace-nowrap">{platformEventLabel(event.type, intlLocale)}</td>
                    <td className="px-3 py-2 text-foreground-subtle">{event.username || "—"}</td>
                    <td className="max-w-72 truncate px-3 py-2 text-ui-xs text-foreground-subtle" title={event.detail}>
                      {event.detail || "—"}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-ui-xs text-foreground-subtle">
                      {formatDateTime(event.createdAt, intlLocale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function PlatformAdminSection() {
  const { intl, locale: intlLocale } = useZCodeIntl();
  const [tab, setTab] = useState<AdminTab>("users");
  const copy = useMemo(() => getPlatformAdminSectionCopy(intlLocale), [intlLocale]);

  const tabs = useMemo(
    () => [
      { value: "users" as const, label: copy.tabUsers },
      { value: "invites" as const, label: copy.tabInvites },
      { value: "groups" as const, label: copy.tabGroups },
      { value: "knowledge" as const, label: copy.tabKnowledge },
      { value: "usage" as const, label: copy.tabUsage },
      { value: "system" as const, label: copy.tabSystem },
      { value: "search" as const, label: copy.tabSearch },
      { value: "browser" as const, label: copy.tabBrowser },
    ],
    [copy],
  );

  return (
    <div className="space-y-4" data-testid="settings-platform-admin-section">
      <SettingsSegmentedTabs items={tabs} value={tab} onValueChange={setTab} />
      {tab === "users" ? <UsersTab /> : null}
      {tab === "invites" ? <InvitesTab /> : null}
      {tab === "groups" ? <GroupsTab /> : null}
      {tab === "knowledge" ? <KnowledgeTab /> : null}
      {tab === "usage" ? <UsageTab /> : null}
      {tab === "system" ? <SystemTab /> : null}
      {tab === "search" ? <SearchTab /> : null}
      {tab === "browser" ? <BrowserTab /> : null}
    </div>
  );
}
