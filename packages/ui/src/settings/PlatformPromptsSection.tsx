import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Badge } from "@/components/ui/badge.js";
import { Input } from "@/components/ui/input.js";
import { Spinner } from "@/components/ui/spinner.js";
import { Switch } from "@/components/ui/switch.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { usePlatformUser } from "@/platformUserStore.js";
import {
  PlatformApiError,
  platformApi,
  platformApiDelete,
  type PlatformPromptRow,
} from "./platformApi.js";
import { getPlatformPromptsCopy } from "./platformPromptsLocale.js";

/**
 * 「提示词」分区（OpenWebUI /workspace/prompts 完整复刻）：
 * - 列表：搜索 + 视图过滤（全部/我创建/他人分享）+ 标签筛选 + 双列卡片；
 * - 编辑器：名称（自动 slugify 命令）+ /命令 + 标签 + 内容 + 全局开关；
 * - 启停：每行 Switch（is_active），停用后聊天 / 面板不再出现；
 * - 聊天集成：带命令的提示词注入聊天输入 / 目录，{{变量}} 弹窗填参（SessionPane）。
 */

/** 名称 → 命令 slugify（OpenWebUI slugify 同语义：小写、非字母数字转 -、去首尾连字符）。 */
function slugifyCommand(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const VIEW_OPTIONS = ["all", "created", "shared"] as const;
type ViewOption = (typeof VIEW_OPTIONS)[number];

export function PlatformPromptsSection() {
  const { intl, locale: intlLocale } = useZCodeIntl();
  const copy = getPlatformPromptsCopy(intlLocale);
  const platformUser = usePlatformUser();
  const isAdmin = platformUser?.role === "admin";

  const [prompts, setPrompts] = useState<PlatformPromptRow[] | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [view, setView] = useState<ViewOption>("all");
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // 编辑器状态
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [command, setCommand] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [isGlobal, setIsGlobal] = useState(false);
  const [busy, setBusy] = useState(false);
  const commandManuallyEdited = useRef(false);

  const load = useCallback(
    async (nextView: ViewOption = view, nextQuery = query, nextTag = selectedTag): Promise<void> => {
      setLoadError(null);
      try {
        const params = new URLSearchParams();
        if (nextView !== "all") params.set("view", nextView);
        if (nextQuery.trim()) params.set("query", nextQuery.trim());
        if (nextTag) params.set("tag", nextTag);
        const suffix = params.size > 0 ? `?${params.toString()}` : "";
        const data = await platformApi<{ prompts: PlatformPromptRow[]; tags: string[] }>(
          `/api/platform/prompts${suffix}`,
        );
        setPrompts(data.prompts);
        setTags(data.tags ?? []);
      } catch (error) {
        setPrompts([]);
        setLoadError(error instanceof PlatformApiError ? error.message : `${copy.loadFailed}: ${String(error)}`);
      }
    },
    [view, query, selectedTag, copy.loadFailed],
  );

  useEffect(() => {
    if (!platformUser) return;
    const timer = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformUser, view, query, selectedTag]);

  if (!platformUser) {
    return (
      <div className="space-y-4" data-testid="settings-platform-prompts-section">
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-ui-sm text-foreground-subtle">
          {copy.platformDisabledHint}
        </p>
      </div>
    );
  }

  const openCreate = (): void => {
    setEditingId(null);
    setTitle("");
    setContent("");
    setCommand("");
    setTagsInput("");
    setIsGlobal(false);
    commandManuallyEdited.current = false;
    setCreateOpen(true);
  };

  const openEdit = (prompt: PlatformPromptRow): void => {
    setEditingId(prompt.id);
    setTitle(prompt.title);
    setContent(prompt.content);
    setCommand(prompt.command ?? "");
    setTagsInput((prompt.tags ?? []).join(", "));
    setIsGlobal(!prompt.ownerId);
    commandManuallyEdited.current = Boolean(prompt.command);
    setCreateOpen(true);
  };

  const submit = async (): Promise<void> => {
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    setLoadError(null);
    const parsedTags = tagsInput
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 20);
    try {
      if (editingId) {
        await platformApi(`/api/platform/prompts/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify({
            title,
            content,
            command,
            ...(parsedTags.length > 0 || tagsInput.trim() ? { tags: parsedTags } : {}),
          }),
        });
      } else {
        await platformApi("/api/platform/prompts", {
          method: "POST",
          body: JSON.stringify({
            title,
            content,
            command,
            ...(parsedTags.length > 0 ? { tags: parsedTags } : {}),
            global: isGlobal && isAdmin,
          }),
        });
      }
      setCreateOpen(false);
      setHint(copy.savedHint);
      await load();
    } catch (requestError) {
      setLoadError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy(false);
    }
  };

  const togglePrompt = async (prompt: PlatformPromptRow): Promise<void> => {
    setBusyId(prompt.id);
    setLoadError(null);
    try {
      await platformApi(`/api/platform/prompts/${prompt.id}/toggle`, { method: "POST" });
      setHint(prompt.isActive === false ? copy.toggleOnHint : copy.toggleOffHint);
      await load();
    } catch (requestError) {
      setLoadError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setBusyId(id);
    setLoadError(null);
    try {
      await platformApiDelete(`/api/platform/prompts/${id}`);
      setConfirmId(null);
      await load();
    } catch (requestError) {
      setLoadError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusyId(null);
    }
  };

  const copyContent = async (prompt: PlatformPromptRow): Promise<void> => {
    try {
      await navigator.clipboard.writeText(prompt.content);
      setHint(copy.copiedHint);
    } catch {
      window.prompt(copy.nameLabel, prompt.content);
    }
  };

  const canWrite = (prompt: PlatformPromptRow): boolean =>
    !prompt.ownerId || prompt.ownerId === platformUser.id || isAdmin;

  return (
    <div className="space-y-4" data-testid="settings-platform-prompts-section">
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="text-ui-base font-semibold text-foreground">{copy.listTitle}</div>
            {prompts !== null ? <Badge variant="secondary">{prompts.length}</Badge> : null}
          </div>
          <div className="flex items-center gap-3">
            {hint ? <span className="text-ui-xs text-foreground-subtle">{hint}</span> : null}
            <Button size="sm" onClick={openCreate}>
              ＋ {copy.newAction}
            </Button>
          </div>
        </header>
        <div className="space-y-3 px-4 py-3">
          {/* 编辑/新建表单 */}
          {createOpen ? (
            <div className="grid gap-3 rounded-xl border border-border bg-surface px-3 py-3">
              <Input
                size="lg"
                autoFocus
                placeholder={copy.nameLabel}
                value={title}
                maxLength={200}
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (!commandManuallyEdited.current) setCommand(slugifyCommand(event.target.value));
                }}
              />
              <div className="space-y-1">
                <Input
                  size="lg"
                  placeholder={copy.commandLabel}
                  value={command}
                  maxLength={64}
                  onChange={(event) => {
                    commandManuallyEdited.current = true;
                    setCommand(event.target.value.replace(/^\/+/, ""));
                  }}
                />
                <p className="text-ui-xs text-foreground-subtle">{copy.commandHint}</p>
                <p className="text-ui-xs text-foreground-subtle">{copy.variableHint}</p>
              </div>
              <Input
                size="lg"
                placeholder={copy.tagsPlaceholder}
                value={tagsInput}
                onChange={(event) => setTagsInput(event.target.value)}
              />
              <Textarea
                rows={5}
                placeholder={copy.contentPlaceholder}
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
              {isAdmin ? (
                <label className="flex items-center gap-2 text-ui-sm text-foreground-subtle">
                  <Switch size="sm" checked={isGlobal} onCheckedChange={setIsGlobal} />
                  {copy.globalToggle}
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

          {/* 过滤条：搜索 + 视图 + 标签 */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-72 flex-1"
              size="lg"
              placeholder={copy.searchPlaceholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="flex items-center gap-1 rounded-lg border border-border bg-surface px-1 py-1">
              {VIEW_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`rounded-md px-2.5 py-1 text-ui-xs transition-colors ${
                    view === option
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground-subtle hover:text-foreground"
                  }`}
                  onClick={() => setView(option)}
                >
                  {option === "all" ? copy.viewAll : option === "created" ? copy.viewCreated : copy.viewShared}
                </button>
              ))}
            </div>
            {tags.length > 0 ? (
              <select
                className="rounded-lg border border-border bg-surface px-2 py-1.5 text-ui-xs text-foreground"
                value={selectedTag}
                onChange={(event) => setSelectedTag(event.target.value)}
              >
                <option value="">{copy.allTags}</option>
                {tags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {loadError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-2 text-ui-xs text-destructive">
              {loadError}
            </div>
          ) : null}

          {prompts === null ? (
            <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
              <Spinner className="size-5" />
            </div>
          ) : prompts.length === 0 ? (
            <div className="px-4 py-8 text-center text-ui-sm text-foreground-subtle">{copy.emptyHint}</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {prompts.map((prompt) => {
                const writable = canWrite(prompt);
                return (
                  <div
                    key={prompt.id}
                    className={`rounded-xl border border-border bg-surface px-4 py-3 ${
                      prompt.isActive === false ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-ui-sm font-medium text-foreground">
                        {prompt.title}
                      </span>
                      {prompt.command ? (
                        <code className="shrink-0 rounded bg-background px-1.5 py-0.5 font-mono text-ui-xs text-foreground-subtle">
                          /{prompt.command}
                        </code>
                      ) : null}
                      {!prompt.ownerId ? <Badge variant="secondary">{copy.badgeGlobal}</Badge> : null}
                      {!writable ? <Badge variant="secondary">{copy.badgeReadOnly}</Badge> : null}
                      {prompt.isActive === false ? <Badge variant="secondary">{copy.badgeDisabled}</Badge> : null}
                    </div>
                    <pre className="mt-2 max-h-20 overflow-y-auto whitespace-pre-wrap text-ui-xs text-foreground-subtle">
                      {prompt.content}
                    </pre>
                    {(prompt.tags?.length ?? 0) > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {prompt.tags!.map((tag) => (
                          <Badge key={tag} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <span className="truncate text-ui-xs text-foreground-subtle">
                        {prompt.ownerUsername
                          ? copy.byOwner.replace("{owner}", prompt.ownerUsername)
                          : ""}{" "}
                        {copy.insertHint}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        {writable ? (
                          busyId === prompt.id ? (
                            <Spinner className="size-4" />
                          ) : (
                            <Switch
                              size="sm"
                              checked={prompt.isActive !== false}
                              onCheckedChange={() => void togglePrompt(prompt)}
                            />
                          )
                        ) : null}
                        <Button size="xs" variant="ghost" onClick={() => void copyContent(prompt)}>
                          {copy.copyAction}
                        </Button>
                        {writable ? (
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
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
