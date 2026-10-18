import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Badge } from "@/components/ui/badge.js";
import { Input } from "@/components/ui/input.js";
import { Spinner } from "@/components/ui/spinner.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { usePlatformUser } from "@/platformUserStore.js";
import {
  PlatformApiError,
  platformApi,
  platformApiDelete,
  type PlatformCollectionFileRow,
  type PlatformKbCollectionRow,
} from "./platformApi.js";
import { getPlatformKnowledgeCopy } from "./platformKnowledgeLocale.js";

/**
 * 「知识库」分区（OpenWebUI /workspace/knowledge 完整复刻，collection 两级模型）：
 * - 列表页：搜索 + 视图过滤（全部/我创建的/他人分享）+ 双列卡片 + 新建；
 * - 详情页：内联编辑名称/描述（500ms 防抖 PATCH）+ 上传文件/添加文本 +
 *   文件列表（分块数/大小/添加者/移除）+ 库内检索预览；
 * - 每用户隔离：普通用户只看/只写自己的集合，admin 旁路可见全部；
 * - agent 经 platform-knowledge MCP 与 /api/platform/kb/search 同源检索。
 */

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDateTime(value: number | undefined, locale: string): string {
  if (!value) return "—";
  try {
    return new Date(Number(value)).toLocaleString(locale.startsWith("zh") ? "zh-CN" : "en-US");
  } catch {
    return "—";
  }
}

const VIEW_OPTIONS = ["all", "created", "shared"] as const;
type ViewOption = (typeof VIEW_OPTIONS)[number];

export function PlatformKnowledgeSection() {
  const { intl, locale: intlLocale } = useZCodeIntl();
  const copy = getPlatformKnowledgeCopy(intlLocale);
  const platformUser = usePlatformUser();
  const isAdmin = platformUser?.role === "admin";

  // ---------- 列表状态 ----------
  const [view, setView] = useState<ViewOption>("all");
  const [listQuery, setListQuery] = useState("");
  const [collections, setCollections] = useState<PlatformKbCollectionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  // ---------- 详情状态 ----------
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlatformKbCollectionRow | null>(null);
  const [detailName, setDetailName] = useState("");
  const [detailDescription, setDetailDescription] = useState("");
  const [files, setFiles] = useState<PlatformCollectionFileRow[] | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [textBusy, setTextBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchHits, setSearchHits] = useState<Array<{ docId: string; docTitle: string; snippet: string }> | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const detailSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCollections = useCallback(
    async (nextView: ViewOption = view, query = listQuery): Promise<void> => {
      setLoadError(null);
      try {
        const params = new URLSearchParams();
        if (nextView !== "all") params.set("view", nextView);
        if (query.trim()) params.set("query", query.trim());
        const suffix = params.size > 0 ? `?${params.toString()}` : "";
        const data = await platformApi<{ collections: PlatformKbCollectionRow[] }>(
          `/api/platform/kb/collections${suffix}`,
        );
        setCollections(data.collections);
      } catch (error) {
        setCollections([]);
        setLoadError(
          error instanceof PlatformApiError ? error.message : `${copy.loadFailed}: ${String(error)}`,
        );
      }
    },
    [view, listQuery, copy.loadFailed],
  );

  useEffect(() => {
    if (!platformUser || activeId) return;
    const timer = setTimeout(() => void loadCollections(view, listQuery), listQuery ? 300 : 0);
    return () => clearTimeout(timer);
  }, [platformUser, activeId, view, listQuery, loadCollections]);

  const loadDetail = useCallback(async (id: string): Promise<void> => {
    setLoadError(null);
    try {
      const data = await platformApi<{ collections: PlatformKbCollectionRow[] }>(
        `/api/platform/kb/collections`,
      );
      const found = data.collections.find((item) => item.id === id) ?? null;
      setDetail(found);
      setDetailName(found?.name ?? "");
      setDetailDescription(found?.description ?? "");
    } catch {
      setDetail(null);
    }
    try {
      const data = await platformApi<{ files: PlatformCollectionFileRow[] }>(
        `/api/platform/kb/collections/${id}/files`,
      );
      setFiles(data.files);
    } catch (error) {
      setFiles([]);
      setLoadError(error instanceof PlatformApiError ? error.message : String(error));
    }
  }, []);

  const openDetail = useCallback(
    (id: string): void => {
      setActiveId(id);
      setFiles(null);
      setSearchHits(null);
      setSearchQuery("");
      setHint(null);
      void loadDetail(id);
    },
    [loadDetail],
  );

  const closeDetail = useCallback((): void => {
    setActiveId(null);
    setDetail(null);
    setFiles(null);
    setSearchHits(null);
    setHint(null);
    void loadCollections();
  }, [loadCollections]);

  // 详情页名称/描述内联编辑（500ms 防抖保存，OpenWebUI changeDebounceHandler 同款）。
  useEffect(() => {
    if (!activeId || !detail) return;
    if (detailName === detail.name && detailDescription === (detail.description ?? "")) return;
    if (detailSaveTimer.current) clearTimeout(detailSaveTimer.current);
    detailSaveTimer.current = setTimeout(async () => {
      try {
        const data = await platformApi<{ collection: PlatformKbCollectionRow }>(
          `/api/platform/kb/collections/${activeId}`,
          {
            method: "PATCH",
            body: JSON.stringify({ name: detailName, description: detailDescription }),
          },
        );
        setDetail(data.collection);
      } catch (error) {
        setLoadError(error instanceof PlatformApiError ? error.message : String(error));
      }
    }, 500);
    return () => {
      if (detailSaveTimer.current) clearTimeout(detailSaveTimer.current);
    };
  }, [activeId, detail, detailName, detailDescription]);

  const createCollection = useCallback(async (): Promise<void> => {
    if (!newName.trim() || createBusy) return;
    setCreateBusy(true);
    setLoadError(null);
    try {
      const data = await platformApi<{ collection: PlatformKbCollectionRow }>(
        "/api/platform/kb/collections",
        {
          method: "POST",
          body: JSON.stringify({
            name: newName,
            ...(newDescription.trim() ? { description: newDescription } : {}),
          }),
        },
      );
      setNewName("");
      setNewDescription("");
      setCreating(false);
      setHint(copy.textAdded);
      await loadCollections();
      openDetail(data.collection.id);
    } catch (error) {
      setLoadError(error instanceof PlatformApiError ? error.message : String(error));
    } finally {
      setCreateBusy(false);
    }
  }, [newName, newDescription, createBusy, copy, loadCollections, openDetail]);

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]): Promise<void> => {
      if (!activeId) return;
      const list = Array.from(fileList);
      if (list.length === 0) return;
      setUploadBusy(true);
      setHint(null);
      setLoadError(null);
      const errors: string[] = [];
      let uploaded = 0;
      for (const file of list) {
        try {
          const form = new FormData();
          form.append("file", file);
          const data = await platformApi<{ textLength?: number }>(
            `/api/platform/kb/collections/${activeId}/files/upload`,
            { method: "POST", body: form },
          );
          uploaded += 1;
          if (typeof data.textLength === "number") {
            setHint(copy.uploadedHint.replace("{name}", file.name).replace("{chars}", String(data.textLength)));
          }
        } catch (error) {
          errors.push(
            `${file.name}: ${error instanceof PlatformApiError ? error.message : String(error)}`,
          );
        }
      }
      if (errors.length > 0) setLoadError(errors.join("；"));
      if (uploaded > 0) await loadDetail(activeId);
      setUploadBusy(false);
    },
    [activeId, copy, loadDetail],
  );

  const submitText = useCallback(async (): Promise<void> => {
    if (!activeId || !textTitle.trim() || !textContent.trim() || textBusy) return;
    setTextBusy(true);
    setHint(null);
    setLoadError(null);
    try {
      // 文本内容：先经 files 管线（保持单一抽取/索引路径），再加入集合。
      const blob = new Blob([textContent], { type: "text/plain" });
      const form = new FormData();
      const filename = textTitle.trim().endsWith(".txt") ? textTitle.trim() : `${textTitle.trim()}.txt`;
      form.append("file", new File([blob], filename, { type: "text/plain" }));
      await platformApi(`/api/platform/kb/collections/${activeId}/files/upload`, {
        method: "POST",
        body: form,
      });
      setTextTitle("");
      setTextContent("");
      setHint(copy.textAdded);
      await loadDetail(activeId);
    } catch (error) {
      setLoadError(error instanceof PlatformApiError ? error.message : String(error));
    } finally {
      setTextBusy(false);
    }
  }, [activeId, textTitle, textContent, textBusy, copy, loadDetail]);

  const removeFile = useCallback(
    async (fileId: string, deleteFileToo: boolean): Promise<void> => {
      if (!activeId) return;
      setBusyFileId(fileId);
      setLoadError(null);
      try {
        await platformApiDelete(
          `/api/platform/kb/collections/${activeId}/files/${fileId}${deleteFileToo ? "?delete_file=true" : ""}`,
        );
        setFiles((previous) => previous?.filter((file) => file.fileId !== fileId) ?? []);
        setDetail((previous) =>
          previous ? { ...previous, fileCount: Math.max(0, previous.fileCount - 1) } : previous,
        );
      } catch (error) {
        setLoadError(error instanceof PlatformApiError ? error.message : String(error));
      } finally {
        setBusyFileId(null);
      }
    },
    [activeId],
  );

  const deleteCollection = useCallback(async (): Promise<void> => {
    if (!activeId || !detail) return;
    if (!window.confirm(copy.deleteConfirm.replace("{name}", detail.name))) return;
    try {
      await platformApiDelete(`/api/platform/kb/collections/${activeId}`);
      closeDetail();
    } catch (error) {
      setLoadError(error instanceof PlatformApiError ? error.message : String(error));
    }
  }, [activeId, detail, copy, closeDetail]);

  const runSearch = useCallback(async (): Promise<void> => {
    if (!activeId || !searchQuery.trim()) return;
    setSearchBusy(true);
    try {
      const data = await platformApi<{
        hits: Array<{ docId: string; docTitle: string; snippet: string }>;
      }>(
        `/api/platform/kb/collections/search?collectionId=${encodeURIComponent(activeId)}&q=${encodeURIComponent(searchQuery)}&limit=6`,
      );
      setSearchHits(data.hits);
    } catch (error) {
      setLoadError(error instanceof PlatformApiError ? error.message : String(error));
      setSearchHits(null);
    } finally {
      setSearchBusy(false);
    }
  }, [activeId, searchQuery]);

  if (!platformUser) {
    return (
      <div className="space-y-4" data-testid="settings-platform-knowledge-section">
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-ui-sm text-foreground-subtle">
          {copy.platformDisabledHint}
        </p>
      </div>
    );
  }

  // ================= 详情页 =================
  if (activeId) {
    return (
      <div className="space-y-4" data-testid="settings-platform-knowledge-section">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={closeDetail}>
            ← {copy.detailBack}
          </Button>
          <div className="flex items-center gap-2">
            {detail ? (
              <span className="text-ui-xs text-foreground-subtle">
                {copy.filesCount.replace("{count}", String(detail.fileCount))}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => void deleteCollection()}
            >
              {copy.deleteCollection}
            </Button>
          </div>
        </div>

        {detail ? (
          <section className="rounded-xl border border-border bg-card px-4 py-3">
            <Input
              size="lg"
              value={detailName}
              maxLength={200}
              placeholder={copy.namePlaceholder}
              onChange={(event) => setDetailName(event.target.value)}
            />
            <Textarea
              className="mt-2"
              rows={2}
              value={detailDescription}
              maxLength={1000}
              placeholder={copy.descriptionPlaceholder}
              onChange={(event) => setDetailDescription(event.target.value)}
            />
          </section>
        ) : (
          <div className="flex items-center justify-center rounded-xl border border-border bg-card px-4 py-8">
            <Spinner className="size-5" />
          </div>
        )}

        {loadError ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-2 text-ui-xs text-destructive">
            {loadError}
          </div>
        ) : null}
        {hint ? (
          <div className="rounded-xl border border-border bg-card px-4 py-2 text-ui-xs text-foreground-subtle">{hint}</div>
        ) : null}

        {/* 添加内容：上传 + 文本 */}
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="text-ui-base font-semibold text-foreground">{copy.addFiles}</div>
            {hint ? <span className="truncate text-ui-xs text-foreground-subtle">{hint}</span> : null}
          </header>
          <div className="px-4 py-3">
            <div
              role="button"
              tabIndex={0}
              className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center transition-colors ${
                dragActive ? "border-accent bg-accent/5" : "border-border hover:bg-surface"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                void uploadFiles(event.dataTransfer.files);
              }}
            >
              {uploadBusy ? (
                <Spinner className="size-5" />
              ) : (
                <>
                  <div className="text-ui-sm font-medium text-foreground">{copy.dropHere}</div>
                  <div className="text-ui-xs text-foreground-subtle">{copy.supportedTypes}</div>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.markdown,.csv,.json,.yaml,.yml,.xml,.html,.log,.docx,.pdf,.ts,.tsx,.js,.py,.go,.rs,.java,.sql,.sh"
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void uploadFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <div className="mt-4 space-y-2 border-t border-border pt-4">
              <div className="text-ui-sm font-medium text-foreground">{copy.addText}</div>
              <Input
                size="lg"
                placeholder={copy.textTitlePlaceholder}
                value={textTitle}
                maxLength={200}
                onChange={(event) => setTextTitle(event.target.value)}
              />
              <Textarea
                placeholder={copy.textContentPlaceholder}
                value={textContent}
                rows={4}
                maxLength={4_000_000}
                onChange={(event) => setTextContent(event.target.value)}
              />
              <Button
                size="sm"
                disabled={textBusy || !textTitle.trim() || !textContent.trim()}
                onClick={() => void submitText()}
              >
                {textBusy ? copy.savingAction : copy.addTextAction}
              </Button>
            </div>
          </div>
        </section>

        {/* 库内检索 */}
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <div className="text-ui-base font-semibold text-foreground">{copy.searchTitle}</div>
          </header>
          <div className="space-y-2 px-4 py-3">
            <div className="flex gap-2">
              <Input
                size="lg"
                placeholder={copy.searchPlaceholder}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runSearch();
                }}
              />
              <Button size="sm" disabled={searchBusy || !searchQuery.trim()} onClick={() => void runSearch()}>
                {searchBusy ? copy.searchingAction : copy.searchAction}
              </Button>
            </div>
            {searchHits !== null ? (
              searchHits.length === 0 ? (
                <p className="text-ui-xs text-foreground-subtle">{copy.searchEmpty}</p>
              ) : (
                <ul className="space-y-2">
                  {searchHits.map((hit, index) => (
                    <li
                      key={`${hit.docId}-${index}`}
                      className="rounded-lg border border-border bg-surface px-3 py-2"
                    >
                      <div className="text-ui-sm font-medium text-foreground">{hit.docTitle}</div>
                      <div className="mt-0.5 line-clamp-3 text-ui-xs text-foreground-subtle">{hit.snippet}</div>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        </section>

        {/* 文件列表 */}
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <div className="text-ui-base font-semibold text-foreground">{copy.filesTitle}</div>
          </header>
          {files === null ? (
            <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
              <Spinner className="size-5" />
            </div>
          ) : files.length === 0 ? (
            <div className="px-4 py-8 text-center text-ui-sm text-foreground-subtle">{copy.filesEmpty}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-ui-sm">
                <thead>
                  <tr className="bg-surface text-ui-xs text-foreground-subtle">
                    <th className="px-4 py-2 text-left font-medium">{copy.colFile}</th>
                    <th className="px-3 py-2 text-left font-medium">{copy.colChunks}</th>
                    <th className="px-3 py-2 text-left font-medium">{copy.colSize}</th>
                    <th className="px-3 py-2 text-left font-medium">{copy.colAddedBy}</th>
                    <th className="px-3 py-2 text-left font-medium">{copy.colAddedAt}</th>
                    <th className="px-4 py-2 text-right font-medium">{copy.colActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file) => (
                    <tr key={file.fileId} className="border-t border-border">
                      <td className="max-w-64 px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-foreground">{file.filename}</span>
                          {file.status === "failed" ? (
                            <Badge variant="secondary">{copy.extractFailed}</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary">{file.chunkCount}</Badge>
                      </td>
                      <td className="px-3 py-2 text-foreground-subtle">{formatSize(Number(file.size))}</td>
                      <td className="max-w-32 truncate px-3 py-2 text-foreground-subtle">
                        {file.addedByUsername ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-foreground-subtle">
                        {formatDateTime(Number(file.addedAt), intlLocale)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {busyFileId === file.fileId ? (
                          <Spinner className="ml-auto size-4" />
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => void removeFile(file.fileId, false)}
                          >
                            {copy.removeAction}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    );
  }

  // ================= 列表页 =================
  return (
    <div className="space-y-4" data-testid="settings-platform-knowledge-section">
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="text-ui-base font-semibold text-foreground">{copy.listTitle}</div>
            {collections !== null ? (
              <Badge variant="secondary">{collections.length}</Badge>
            ) : null}
          </div>
          <Button size="sm" onClick={() => setCreating((previous) => !previous)}>
            ＋ {copy.newAction}
          </Button>
        </header>
        <div className="space-y-3 px-4 py-3">
          {/* 新建表单（OpenWebUI /workspace/knowledge/create 对应） */}
          {creating ? (
            <div className="space-y-2 rounded-xl border border-border bg-surface px-3 py-3">
              <Input
                size="lg"
                autoFocus
                placeholder={copy.namePlaceholder}
                value={newName}
                maxLength={200}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createCollection();
                }}
              />
              <Textarea
                rows={2}
                placeholder={copy.descriptionPlaceholder}
                value={newDescription}
                maxLength={1000}
                onChange={(event) => setNewDescription(event.target.value)}
              />
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={createBusy || !newName.trim()} onClick={() => void createCollection()}>
                  {createBusy ? copy.savingAction : copy.newAction}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                    setNewDescription("");
                  }}
                >
                  ✕
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-72 flex-1"
              size="lg"
              placeholder={copy.searchPlaceholder}
              value={listQuery}
              onChange={(event) => setListQuery(event.target.value)}
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
                  onClick={() => {
                    setView(option);
                    void loadCollections(option, listQuery);
                  }}
                >
                  {option === "all" ? copy.viewAll : option === "created" ? copy.viewCreated : copy.viewShared}
                </button>
              ))}
            </div>
          </div>

          {loadError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-2 text-ui-xs text-destructive">
              {loadError}
            </div>
          ) : null}

          {collections === null ? (
            <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
              <Spinner className="size-5" />
            </div>
          ) : collections.length === 0 ? (
            <div className="px-4 py-10 text-center text-ui-sm text-foreground-subtle">{copy.emptyHint}</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {collections.map((collection) => (
                <button
                  key={collection.id}
                  type="button"
                  className="rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-accent/5"
                  onClick={() => openDetail(collection.id)}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{copy.badgeCollection}</Badge>
                    <span className="min-w-0 flex-1 truncate text-ui-sm font-medium text-foreground">
                      {collection.name}
                    </span>
                    <span className="whitespace-nowrap text-ui-xs text-foreground-subtle">
                      {copy.filesCount.replace("{count}", String(collection.fileCount))}
                    </span>
                  </div>
                  {collection.description ? (
                    <div className="mt-1.5 line-clamp-2 text-ui-xs text-foreground-subtle">
                      {collection.description}
                    </div>
                  ) : null}
                  <div className="mt-2 flex items-center gap-2 text-ui-xs text-foreground-subtle">
                    <span>{formatDateTime(Number(collection.updatedAt), intlLocale)}</span>
                    <span>·</span>
                    <span className="truncate">
                      {copy.byOwner.replace("{owner}", collection.ownerUsername ?? "—")}
                    </span>
                    {isAdmin && collection.ownerId !== platformUser.id ? (
                      <Badge variant="secondary">{collection.ownerUsername ?? "—"}</Badge>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
