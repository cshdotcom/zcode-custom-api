#!/usr/bin/env node
/**
 * ZCode 平台联网搜索 MCP server（零依赖，stdio 传输）。
 *
 * 在 agent 进程内作为 stdio MCP server 被拉起（~/.zcode/cli/config.json → mcp.servers），
 * 暴露 web_search / fetch_page 两个工具：
 * - web_search: 经 ZCode Server 的统一搜索 API（多 Provider + OpenWebUI 兼容）执行联网搜索；
 * - fetch_page: 抓取指定 URL 的正文文本（去标签截断），供引用阅读。
 *
 * 环境变量：
 * - ZCODE_PLATFORM_SEARCH_URL   搜索 API 基址（默认 http://127.0.0.1:3000）
 * - ZCODE_PLATFORM_SEARCH_TOKEN 平台内部服务 Bearer Token（与 server 侧 ZCODE_PLATFORM_SERVICE_TOKEN 一致）
 */

import { createInterface } from "node:readline";

const BASE_URL = (process.env.ZCODE_PLATFORM_SEARCH_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const TOKEN = process.env.ZCODE_PLATFORM_SEARCH_TOKEN || "";
const SERVER_INFO = { name: "platform-web-search", version: "0.1.0" };
const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
  {
    name: "web_search",
    description:
      "联网搜索工具：调用平台搜索服务（支持 DuckDuckGo/Tavily/Brave/Google/Bing/Serper/SearXNG/Jina/Exa/博查/智谱/OpenWebUI 兼容端点），返回带标题、链接与摘要的结果列表。需要查询实时信息、新闻、文档、价格等场景使用。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        count: { type: "number", description: "返回条数（1-20，默认使用平台配置）" },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_page",
    description: "抓取指定 URL 的网页正文文本（去除 HTML 标签并截断），用于阅读搜索结果或任意网页内容。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "要抓取的网页地址（http/https）" },
        maxLength: { type: "number", description: "返回文本最大长度（默认 8000 字符）" },
      },
      required: ["url"],
    },
  },
];

function writeFrame(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function reply(id, result) {
  writeFrame({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  writeFrame({ jsonrpc: "2.0", id, error: { code, message } });
}

async function searchWeb(args) {
  const query = String(args?.query ?? "").trim();
  if (!query) throw new Error("query 不能为空");
  const url = new URL(`${BASE_URL}/api/platform/search`);
  url.searchParams.set("q", query);
  if (args?.count !== undefined) url.searchParams.set("count", String(Math.min(20, Math.max(1, Number(args.count) || 8))));
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `搜索 API HTTP ${response.status}`);
  const results = Array.isArray(data.results) ? data.results : [];
  if (results.length === 0) return { content: [{ type: "text", text: "没有找到相关结果。" }] };
  const lines = results.map(
    (item, index) =>
      `${index + 1}. ${item.title}\n   链接: ${item.url}\n   摘要: ${item.snippet || "(无摘要)"}`,
  );
  return {
    content: [{ type: "text", text: `搜索「${query}」共 ${results.length} 条结果：\n\n${lines.join("\n\n")}` }],
  };
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(args) {
  const rawUrl = String(args?.url ?? "").trim();
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`无效 URL: ${rawUrl}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("仅支持 http/https");
  const response = await fetch(parsed, {
    headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36" },
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  });
  const contentType = response.headers.get("content-type") ?? "";
  const maxLength = Math.min(50_000, Math.max(200, Number(args?.maxLength) || 8000));
  if (contentType.includes("application/json")) {
    const text = (await response.text()).slice(0, maxLength);
    return { content: [{ type: "text", text: `URL: ${parsed}\n(JSON 响应)\n\n${text}` }] };
  }
  const html = await response.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]) : "(无标题)";
  const body = stripHtml(html).slice(0, maxLength);
  return {
    content: [{ type: "text", text: `URL: ${parsed}\n标题: ${title}\n\n${body}` }],
  };
}

async function callTool(name, args) {
  switch (name) {
    case "web_search":
      return await searchWeb(args);
    case "fetch_page":
      return await fetchPage(args);
    default:
      throw new Error(`未知工具: ${name}`);
  }
}

const readline = createInterface({ input: process.stdin, terminal: false });
readline.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (method === "initialize") {
    reply(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
    return;
  }
  if (method === "notifications/initialized" || method?.startsWith("notifications/")) return;
  if (method === "ping") {
    reply(id, {});
    return;
  }
  if (method === "tools/list") {
    reply(id, { tools: TOOLS });
    return;
  }
  if (method === "tools/call") {
    callTool(params?.name, params?.arguments)
      .then((result) => reply(id, result))
      .catch((error) =>
        reply(id, {
          content: [{ type: "text", text: `工具执行失败: ${error?.message ?? String(error)}` }],
          isError: true,
        }),
      );
    return;
  }
  if (id !== undefined) replyError(id, -32601, `Method not found: ${method}`);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
process.stderr.write(`[platform-web-search] ready (base: ${BASE_URL})\n`);
