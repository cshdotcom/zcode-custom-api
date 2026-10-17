import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 平台联网搜索服务。
 *
 * 两个方向的能力：
 * 1. 作为客户端聚合常用搜索 API（Tavily / Brave / Google PSE / Bing / Serper / SearXNG /
 *    DuckDuckGo / Jina / Exa / 博查 / 智谱 / OpenWebUI 兼容自定义端点），统一结果结构；
 * 2. 作为服务端对外暴露与 OpenWebUI 兼容的搜索接口：
 *    - OpenWebUI「外部搜索(external)」模式：POST {query, count} → [{link,title,snippet}]
 *    - OpenWebUI「SearXNG」引擎模式：GET /search?q=&format=json → {query, results:[{title,url,content}]}
 *
 * 配置持久化于 <configDir>/platform/search.json，可经管理页或 API 热切换 Provider。
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  provider: string;
}

export interface SearchProviderConfig {
  /** 当前激活的 Provider id。 */
  provider: string;
  /** Provider 鉴权密钥（部分 Provider 可留空，如 duckduckgo / searxng）。 */
  apiKey?: string;
  /** 自定义端点（searxng 的查询地址 / custom 的 OpenWebUI 兼容 URL）。 */
  baseUrl?: string;
  /** 智谱搜索引擎标识（search_std / search_pro 等）。 */
  engine?: string;
  /** 默认返回条数。 */
  count: number;
  /** 对外暴露 OpenWebUI 兼容端点时要求的 Bearer Token（留空 = 不校验）。 */
  apiToken?: string;
  /** 是否允许匿名访问对外搜索端点（默认允许，配合 apiToken 校验）。 */
  publicEndpoint?: boolean;
}

export const SEARCH_PROVIDERS: Array<{
  id: string;
  name: string;
  requiresApiKey: boolean;
  requiresBaseUrl: boolean;
  description: string;
}> = [
  { id: "duckduckgo", name: "DuckDuckGo", requiresApiKey: false, requiresBaseUrl: false, description: "无需密钥，适合开箱即用" },
  { id: "tavily", name: "Tavily", requiresApiKey: true, requiresBaseUrl: false, description: "面向 LLM 的搜索 API" },
  { id: "brave", name: "Brave Search", requiresApiKey: true, requiresBaseUrl: false, description: "Brave Search API" },
  { id: "google_pse", name: "Google PSE", requiresApiKey: true, requiresBaseUrl: true, description: "Google 可编程搜索引擎（baseUrl 填 cx）" },
  { id: "bing", name: "Bing Search v7", requiresApiKey: true, requiresBaseUrl: false, description: "Azure Bing Search v7" },
  { id: "serper", name: "Serper.dev", requiresApiKey: true, requiresBaseUrl: false, description: "Google 结果聚合 API" },
  { id: "searxng", name: "SearXNG", requiresApiKey: false, requiresBaseUrl: true, description: "自建 SearXNG 实例（baseUrl 填 /search 地址）" },
  { id: "jina", name: "Jina s.jina.ai", requiresApiKey: false, requiresBaseUrl: false, description: "Jina 搜索（可选密钥提高配额）" },
  { id: "exa", name: "Exa", requiresApiKey: true, requiresBaseUrl: false, description: "Exa neural search" },
  { id: "bocha", name: "博查 Bocha", requiresApiKey: true, requiresBaseUrl: false, description: "国内可用的网页搜索 API" },
  { id: "zhipu", name: "智谱 Web Search", requiresApiKey: true, requiresBaseUrl: false, description: "bigmodel.cn 网页搜索工具" },
  { id: "custom", name: "OpenWebUI 兼容自定义", requiresApiKey: false, requiresBaseUrl: true, description: "POST {query,count} → [{link,title,snippet}] 的任意端点" },
];

const DEFAULT_CONFIG: SearchProviderConfig = {
  provider: "duckduckgo",
  count: 8,
  publicEndpoint: true,
};

const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export class SearchService {
  #config: SearchProviderConfig;
  readonly #configPath: string;

  constructor(configDir: string) {
    const dir = join(configDir, "platform");
    mkdirSync(dir, { recursive: true });
    this.#configPath = join(dir, "search.json");
    this.#config = this.#load();
  }

  get config(): SearchProviderConfig {
    return { ...this.#config };
  }

  updateConfig(patch: Partial<SearchProviderConfig>): SearchProviderConfig {
    const next: SearchProviderConfig = {
      ...this.#config,
      ...patch,
      count: Math.min(20, Math.max(1, Number(patch.count ?? this.#config.count) || 8)),
    };
    const provider = SEARCH_PROVIDERS.find((item) => item.id === next.provider);
    if (!provider) throw new Error(`未知搜索 Provider: ${next.provider}`);
    if (provider.requiresApiKey && !next.apiKey?.trim()) {
      throw new Error(`Provider ${provider.name} 需要 apiKey`);
    }
    if (provider.requiresBaseUrl && !next.baseUrl?.trim()) {
      throw new Error(`Provider ${provider.name} 需要 baseUrl`);
    }
    this.#config = next;
    writeFileSync(this.#configPath, JSON.stringify(next, null, 2), "utf-8");
    return { ...next };
  }

  #load(): SearchProviderConfig {
    try {
      const raw = JSON.parse(readFileSync(this.#configPath, "utf-8")) as Partial<SearchProviderConfig>;
      return { ...DEFAULT_CONFIG, ...raw };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  async search(query: string, countOverride?: number): Promise<WebSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) throw new Error("query 不能为空");
    const count = Math.min(20, Math.max(1, countOverride ?? this.#config.count));
    const providerId = this.#config.provider;
    const results = await this.#dispatch(providerId, trimmed, count);
    return results.map((item) => ({ ...item, provider: item.provider || providerId }));
  }

  async #dispatch(providerId: string, query: string, count: number): Promise<WebSearchResult[]> {
    switch (providerId) {
      case "duckduckgo":
        return await searchDuckDuckGo(query, count);
      case "tavily":
        return await searchTavily(query, count, this.#require("apiKey"));
      case "brave":
        return await searchBrave(query, count, this.#require("apiKey"));
      case "google_pse":
        return await searchGooglePse(query, count, this.#require("apiKey"), this.#require("baseUrl"));
      case "bing":
        return await searchBing(query, count, this.#require("apiKey"));
      case "serper":
        return await searchSerper(query, count, this.#require("apiKey"));
      case "searxng":
        return await searchSearxng(query, count, this.#require("baseUrl"));
      case "jina":
        return await searchJina(query, count, this.#config.apiKey?.trim() || undefined);
      case "exa":
        return await searchExa(query, count, this.#require("apiKey"));
      case "bocha":
        return await searchBocha(query, count, this.#require("apiKey"));
      case "zhipu":
        return await searchZhipu(query, count, this.#require("apiKey"), this.#config.engine || "search_std");
      case "custom":
        return await searchOpenWebUiCompatible(query, count, this.#require("baseUrl"), this.#config.apiKey?.trim() || undefined);
      default:
        throw new Error(`未实现的搜索 Provider: ${providerId}`);
    }
  }

  #require(field: "apiKey" | "baseUrl"): string {
    const value = this.#config[field]?.trim();
    if (!value) throw new Error(`搜索 Provider ${this.#config.provider} 缺少配置项 ${field}`);
    return value;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "User-Agent": USER_AGENT, ...(init.headers ?? {}) },
  });
}

function clip(value: unknown, max = 400): string {
  const text = typeof value === "string" ? value : "";
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function decodeDuckHref(href: string): string {
  try {
    if (href.startsWith("//")) href = `https:${href}`;
    const url = new URL(href, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return url.toString();
  } catch {
    return href;
  }
}

async function searchDuckDuckGo(query: string, count: number): Promise<WebSearchResult[]> {
  const response = await fetchWithTimeout("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }).toString(),
  });
  if (!response.ok) throw new Error(`DuckDuckGo HTTP ${response.status}`);
  const html = await response.text();
  const results: WebSearchResult[] = [];
  const anchorPattern =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetPattern = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets: string[] = [];
  let snippetMatch: RegExpExecArray | null;
  while ((snippetMatch = snippetPattern.exec(html)) !== null && snippets.length < count * 2) {
    snippets.push(snippetMatch[1] ?? "");
  }
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = anchorPattern.exec(html)) !== null && results.length < count) {
    const href = match[1] ?? "";
    const title = clip(match[2]?.replace(/<[^>]+>/g, ""));
    const url = decodeDuckHref(href);
    if (!title || !url.startsWith("http")) continue;
    const rawSnippet = snippets[index] ?? "";
    results.push({
      title,
      url,
      snippet: clip(rawSnippet.replace(/<[^>]+>/g, "")),
      provider: "duckduckgo",
    });
    index += 1;
  }
  return results;
}

async function searchTavily(query: string, count: number, apiKey: string): Promise<WebSearchResult[]> {
  const response = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: count, search_depth: "basic" }),
  });
  if (!response.ok) throw new Error(`Tavily HTTP ${response.status}: ${clip(await response.text(), 200)}`);
  const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? []).slice(0, count).map((item) => ({
    title: clip(item.title) || "(无标题)",
    url: item.url ?? "",
    snippet: clip(item.content),
    content: clip(item.content, 1200),
    provider: "tavily",
  }));
}

async function searchBrave(query: string, count: number, apiKey: string): Promise<WebSearchResult[]> {
  const response = await fetchWithTimeout(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
    { headers: { Accept: "application/json", "X-Subscription-Token": apiKey } },
  );
  if (!response.ok) throw new Error(`Brave HTTP ${response.status}: ${clip(await response.text(), 200)}`);
  const data = (await response.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (data.web?.results ?? []).slice(0, count).map((item) => ({
    title: clip(item.title) || "(无标题)",
    url: item.url ?? "",
    snippet: clip(item.description),
    provider: "brave",
  }));
}

async function searchGooglePse(query: string, count: number, apiKey: string, cx: string): Promise<WebSearchResult[]> {
  const response = await fetchWithTimeout(
    `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&num=${count}&q=${encodeURIComponent(query)}`,
  );
  if (!response.ok) throw new Error(`Google PSE HTTP ${response.status}: ${clip(await response.text(), 200)}`);
  const data = (await response.json()) as { items?: Array<{ title?: string; link?: string; snippet?: string }> };
  return (data.items ?? []).slice(0, count).map((item) => ({
    title: clip(item.title) || "(无标题)",
    url: item.link ?? "",
    snippet: clip(item.snippet),
    provider: "google_pse",
  }));
}

async function searchBing(query: string, count: number, apiKey: string): Promise<WebSearchResult[]> {
  const response = await fetchWithTimeout(
    `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${count}&responseFilter=webPages`,
    { headers: { "Ocp-Apim-Subscription-Key": apiKey } },
  );
  if (!response.ok) throw new Error(`Bing HTTP ${response.status}: ${clip(await response.text(), 200)}`);
  const data = (await response.json()) as { webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> } };
  return (data.webPages?.value ?? []).slice(0, count).map((item) => ({
    title: clip(item.name) || "(无标题)",
    url: item.url ?? "",
    snippet: clip(item.snippet),
    provider: "bing",
  }));
}

async function searchSerper(query: string, count: number, apiKey: string): Promise<WebSearchResult[]> {
  const response = await fetchWithTimeout("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ q: query, num: count }),
  });
  if (!response.ok) throw new Error(`Serper HTTP ${response.status}: ${clip(await response.text(), 200)}`);
  const data = (await response.json()) as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
  return (data.organic ?? []).slice(0, count).map((item) => ({
    title: clip(item.title) || "(无标题)",
    url: item.link ?? "",
    snippet: clip(item.snippet),
    provider: "serper",
  }));
}

async function searchSearxng(query: string, count: number, baseUrl: string): Promise<WebSearchResult[]> {
  const url = new URL(baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}: ${clip(await response.text(), 200)}`);
  const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? []).slice(0, count).map((item) => ({
    title: clip(item.title) || "(无标题)",
    url: item.url ?? "",
    snippet: clip(item.content),
    content: clip(item.content, 1200),
    provider: "searxng",
  }));
}

async function searchJina(query: string, count: number, apiKey?: string): Promise<WebSearchResult[]> {
  const response = await fetchWithTimeout(`https://s.jina.ai/${encodeURIComponent(query)}`, {
    headers: {
      Accept: "application/json",
      "X-Respond-With": "no-content",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`Jina HTTP ${response.status}: ${clip(await response.text(), 200)}`);
  const data = (await response.json()) as {
    data?: Array<{ title?: string; url?: string; description?: string; content?: string }>;
  };
  return (data.data ?? []).slice(0, count).map((item) => ({
    title: clip(item.title) || "(无标题)",
    url: item.url ?? "",
    snippet: clip(item.description ?? item.content),
    provider: "jina",
  }));
}

async function searchExa(query: string, count: number, apiKey: string): Promise<WebSearchResult[]> {
  const response = await fetchWithTimeout("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ query, numResults: count, contents: { text: { maxCharacters: 1200 } } }),
  });
  if (!response.ok) throw new Error(`Exa HTTP ${response.status}: ${clip(await response.text(), 200)}`);
  const data = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; text?: string; summary?: string }>;
  };
  return (data.results ?? []).slice(0, count).map((item) => ({
    title: clip(item.title) || "(无标题)",
    url: item.url ?? "",
    snippet: clip(item.summary ?? item.text),
    content: clip(item.text, 1200),
    provider: "exa",
  }));
}

async function searchBocha(query: string, count: number, apiKey: string): Promise<WebSearchResult[]> {
  const response = await fetchWithTimeout("https://api.bochaai.com/v1/web-search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, summary: true, count }),
  });
  if (!response.ok) throw new Error(`Bocha HTTP ${response.status}: ${clip(await response.text(), 200)}`);
  const data = (await response.json()) as {
    data?: { webPages?: { value?: Array<{ name?: string; url?: string; summary?: string; snippet?: string }> } };
  };
  return (data.data?.webPages?.value ?? []).slice(0, count).map((item) => ({
    title: clip(item.name) || "(无标题)",
    url: item.url ?? "",
    snippet: clip(item.summary ?? item.snippet),
    provider: "bocha",
  }));
}

async function searchZhipu(query: string, count: number, apiKey: string, engine: string): Promise<WebSearchResult[]> {
  const response = await fetchWithTimeout("https://open.bigmodel.cn/api/paas/v4/web_search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ search_engine: engine, search_query: query, count }),
  });
  if (!response.ok) throw new Error(`Zhipu HTTP ${response.status}: ${clip(await response.text(), 200)}`);
  const data = (await response.json()) as {
    search_result?: Array<{ title?: string; link?: string; content?: string; media?: string }>;
  };
  return (data.search_result ?? []).slice(0, count).map((item) => ({
    title: clip(item.title) || "(无标题)",
    url: item.link ?? "",
    snippet: clip(item.content),
    content: clip(item.content, 1200),
    provider: "zhipu",
  }));
}

/** OpenWebUI 外部搜索兼容上游：POST {query, count} → [{link,title,snippet}]。 */
async function searchOpenWebUiCompatible(
  query: string,
  count: number,
  baseUrl: string,
  apiKey?: string,
): Promise<WebSearchResult[]> {
  const response = await fetchWithTimeout(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ query, count }),
  });
  if (!response.ok) throw new Error(`Custom search HTTP ${response.status}: ${clip(await response.text(), 200)}`);
  const data = (await response.json()) as Array<{ link?: string; title?: string; snippet?: string }>;
  const list = Array.isArray(data) ? data : [];
  return list.slice(0, count).map((item) => ({
    title: clip(item.title) || "(无标题)",
    url: item.link ?? "",
    snippet: clip(item.snippet),
    provider: "custom",
  }));
}
