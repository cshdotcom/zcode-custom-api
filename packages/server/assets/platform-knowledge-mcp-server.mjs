#!/usr/bin/env node
/**
 * ZCode 平台知识库 MCP server（零依赖，stdio 传输）。
 *
 * 在 agent 进程内作为 stdio MCP server 被拉起（~/.zcode/cli/config.json → mcp.servers），
 * 暴露 search_knowledge 工具：
 * - search_knowledge: 在平台知识库（管理员维护的文档集，FTS5 全文索引）中检索相关片段，
 *   供 agent 回答基于私有文档的问题时引用。
 *
 * 环境变量：
 * - ZCODE_PLATFORM_KB_URL   知识库 API 基址（默认 http://127.0.0.1:3000）
 * - ZCODE_PLATFORM_KB_TOKEN 平台内部服务 Bearer Token（与 server 侧 ZCODE_PLATFORM_SERVICE_TOKEN 一致）
 */

import { createInterface } from "node:readline";

const BASE_URL = (process.env.ZCODE_PLATFORM_KB_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const TOKEN = process.env.ZCODE_PLATFORM_KB_TOKEN || "";
const SERVER_INFO = { name: "platform-knowledge", version: "0.1.0" };
const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
  {
    name: "search_knowledge",
    description:
      "平台知识库检索工具：在管理员上传的私有文档（产品手册/规范/FAQ/资料等）中做全文检索，返回最相关的文档片段。回答涉及公司内部知识、私有文档内容的问题时必须先调用本工具。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词（支持多词 AND 组合）" },
        limit: { type: "number", description: "返回片段数（1-20，默认 6）" },
      },
      required: ["query"],
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

async function searchKnowledge(args) {
  const query = String(args?.query ?? "").trim();
  if (!query) throw new Error("query 不能为空");
  const url = new URL(`${BASE_URL}/api/platform/kb/search`);
  url.searchParams.set("q", query);
  if (args?.limit !== undefined) url.searchParams.set("limit", String(Math.min(20, Math.max(1, Number(args.limit) || 6))));
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `知识库 API HTTP ${response.status}`);
  const hits = Array.isArray(data.hits) ? data.hits : [];
  if (hits.length === 0) return { content: [{ type: "text", text: "知识库中没有找到相关内容。" }] };
  const lines = hits.map(
    (hit, index) => `【${index + 1}】文档《${hit.docTitle}》\n${hit.snippet}`,
  );
  return {
    content: [
      { type: "text", text: `知识库检索「${query}」命中 ${hits.length} 个片段：\n\n${lines.join("\n\n")}` },
    ],
  };
}

async function handleCall(name, args) {
  switch (name) {
    case "search_knowledge":
      return searchKnowledge(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function main() {
  const reader = createInterface({ input: process.stdin });
  const buffer = [];
  let processing = false;
  const drain = () => {
    if (processing) return;
    const line = buffer.shift();
    if (line === undefined) return;
    processing = true;
    void (async () => {
      try {
        const message = JSON.parse(line);
        const method = message?.method;
        const id = message?.id;
        if (method === "initialize") {
          reply(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          });
        } else if (method === "notifications/initialized" || method?.startsWith("notifications/")) {
          // 通知无需应答。
        } else if (method === "ping") {
          reply(id, {});
        } else if (method === "tools/list") {
          reply(id, { tools: TOOLS });
        } else if (method === "tools/call") {
          const name = message.params?.name;
          try {
            const result = await handleCall(name, message.params?.arguments ?? {});
            reply(id, result);
          } catch (error) {
            replyError(id, -32000, error instanceof Error ? error.message : String(error));
          }
        } else if (id !== undefined) {
          replyError(id, -32601, `Method not found: ${method}`);
        }
      } catch {
        // 单帧解析失败不中断服务。
      } finally {
        processing = false;
        drain();
      }
    })();
  };
  reader.on("line", (line) => {
    if (!line.trim()) return;
    buffer.push(line);
    drain();
  });
  reader.on("close", () => process.exit(0));
}

main();
