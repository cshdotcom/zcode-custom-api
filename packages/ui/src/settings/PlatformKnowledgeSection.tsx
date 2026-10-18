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
  type PlatformKbDocRow,
} from "./platformApi.js";
import { getPlatformKnowledgeCopy } from "./platformKnowledgeLocale.js";

/**
 * 设置页「知识库」分区（OpenWebUI /workspace/knowledge 用户级复刻）：
 * - 文件上传：txt/md/代码直读、docx 解包、pdf 尽力提取 → 自动分块 + FTS5 索引；
 * - 纯文本内容：粘贴文本直接入库；
 * - 试检索：FTS5 关键词命中预览（agent 侧经 platform-knowledge MCP 检索同源）；
 * - 每用户隔离：普通用户只看/只删自己的文档，admin 全库可见。
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

export function PlatformKnowledgeSection() {
  const { intl, locale: intlLocale } = useZCodeIntl();
  const copy = getPlatformKnowledgeCopy(intlLocale);
  const platformUser = usePlatformUser();
  const isAdmin = platformUser?.role === "admin";

  const [docs, setDocs] = useState<PlatformKbDocRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // 纯文本入库
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [textBusy, setTextBusy] = useState(false);

  // 试检索
  const [searchQuery, setSearchQuery] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchHits, setSearchHits] = useState<Array<{ docId: string; docTitle: string; snippet: string }> | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadDocs = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      const data = await platformApi<{ docs: PlatformKbDocRow[] }>("/api/platform/kb");
      setDocs(data.docs);
    } catch (error) {
      setDocs([]);
      setLoadError(error instanceof PlatformApiError ? error.message : `${copy.loadFailed}: ${String(error)}`);
    }
  }, [copy.loadFailed]);

  useEffect(() => {
    if (!platformUser) return;
    void loadDocs();
  }, [platformUser, loadDocs]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]): Promise<void> => {
      const list = Array.from(files);
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
          const data = await platformApi<{ engine: string; textLength: number }>(
            "/api/platform/kb/upload",
            { method: "POST", body: form },
          );
          uploaded += 1;
          setHint(
            copy.uploadedHint.replace("{name}", file.name).replace("{chars}", String(data.textLength)),
          );
        } catch (error) {
          errors.push(
            `${file.name}: ${error instanceof PlatformApiError ? error.message : String(error)}`,
          );
        }
      }
      if (errors.length > 0) setLoadError(errors.join("；"));
      if (uploaded > 0) await loadDocs();
      setUploadBusy(false);
    },
    [copy, loadDocs],
  );

  const submitText = useCallback(async (): Promise<void> => {
    if (!textTitle.trim() || !textContent.trim() || textBusy) return;
    setTextBusy(true);
    setHint(null);
    setLoadError(null);
    try {
      await platformApi("/api/platform/kb", {
        method: "POST",
        body: JSON.stringify({ title: textTitle, content: textContent }),
      });
      setTextTitle("");
      setTextContent("");
      setHint(copy.textAdded);
      await loadDocs();
    } catch (error) {
      setLoadError(error instanceof PlatformApiError ? error.message : String(error));
    } finally {
      setTextBusy(false);
    }
  }, [textTitle, textContent, textBusy, copy, loadDocs]);

  const runSearch = useCallback(async (): Promise<void> => {
    if (!searchQuery.trim()) return;
    setSearchBusy(true);
    try {
      const data = await platformApi<{ hits: Array<{ docId: string; docTitle: string; snippet: string }> }>(
        `/api/platform/kb/search?q=${encodeURIComponent(searchQuery)}&limit=6`,
      );
      setSearchHits(data.hits);
    } catch (error) {
      setLoadError(error instanceof PlatformApiError ? error.message : String(error));
      setSearchHits(null);
    } finally {
      setSearchBusy(false);
    }
  }, [searchQuery]);

  const deleteDoc = useCallback(
    async (id: string): Promise<void> => {
      setBusyId(id);
      setHint(null);
      setLoadError(null);
      try {
        await platformApiDelete(`/api/platform/kb/${id}`);
        setDocs((previous) => previous?.filter((doc) => doc.id !== id) ?? []);
      } catch (error) {
        setLoadError(error instanceof PlatformApiError ? error.message : String(error));
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  if (!platformUser) {
    return (
      <div className="space-y-4" data-testid="settings-platform-knowledge-section">
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-ui-sm text-foreground-subtle">
          {copy.platformDisabledHint}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="settings-platform-knowledge-section">
      {/* 上传区 */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-ui-base font-semibold text-foreground">{copy.uploadTitle}</div>
            <div className="mt-0.5 text-ui-xs text-foreground-subtle">{copy.uploadDescription}</div>
          </div>
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

          {/* 纯文本入库 */}
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <div className="text-ui-sm font-medium text-foreground">{copy.addTextTitle}</div>
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

      {/* 试检索 */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <div className="text-ui-base font-semibold text-foreground">{copy.searchTitle}</div>
          <div className="mt-0.5 text-ui-xs text-foreground-subtle">{copy.searchDescription}</div>
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

      {/* 文档列表 */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-ui-base font-semibold text-foreground">{copy.docsTitle}</div>
            <div className="mt-0.5 text-ui-xs text-foreground-subtle">
              {isAdmin ? copy.docsDescriptionAdmin : copy.docsDescription}
            </div>
          </div>
        </header>
        {loadError ? (
          <div className="border-b border-border px-4 py-2 text-ui-xs text-destructive">{loadError}</div>
        ) : null}
        {docs === null ? (
          <div className="flex items-center justify-center px-4 py-10 text-foreground-subtle">
            <Spinner className="size-5" />
          </div>
        ) : docs.length === 0 ? (
          <div className="px-4 py-8 text-center text-ui-sm text-foreground-subtle">{copy.docsEmpty}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-ui-sm">
              <thead>
                <tr className="bg-surface text-ui-xs text-foreground-subtle">
                  <th className="px-4 py-2 text-left font-medium">{copy.colTitle}</th>
                  <th className="px-3 py-2 text-left font-medium">{copy.colChunks}</th>
                  <th className="px-3 py-2 text-left font-medium">{copy.colSize}</th>
                  {isAdmin ? <th className="px-3 py-2 text-left font-medium">{copy.colOwner}</th> : null}
                  <th className="px-3 py-2 text-left font-medium">{copy.colCreated}</th>
                  <th className="px-4 py-2 text-right font-medium">{copy.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => (
                  <tr key={doc.id} className="border-t border-border">
                    <td className="max-w-64 px-4 py-2">
                      <div className="truncate font-medium text-foreground">{doc.title}</div>
                      {doc.filename ? (
                        <div className="truncate text-ui-xs text-foreground-subtle">{doc.filename}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary">{doc.chunkCount}</Badge>
                    </td>
                    <td className="px-3 py-2 text-foreground-subtle">{formatSize(Number(doc.size))}</td>
                    {isAdmin ? (
                      <td className="max-w-32 truncate px-3 py-2 text-foreground-subtle">
                        {doc.ownerUsername ?? "—"}
                      </td>
                    ) : null}
                    <td className="whitespace-nowrap px-3 py-2 text-foreground-subtle">
                      {formatDateTime(Number(doc.createdAt), intlLocale)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {busyId === doc.id ? (
                        <Spinner className="ml-auto size-4" />
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void deleteDoc(doc.id)}
                        >
                          {copy.deleteAction}
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
