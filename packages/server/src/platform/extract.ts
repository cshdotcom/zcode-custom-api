/**
 * 知识库文档文本抽取（standalone-deep-integration 定制）。
 *
 * 对齐 OpenWebUI 知识库上传管线的前半段（loader → 文本），不做向量嵌入 ——
 * 检索由 SQLite FTS5 全文索引承担。支持：
 * - 纯文本类（txt/md/markdown/csv/json/code/html/xml/yaml/log）：UTF-8 直读
 * - docx（Office Open XML）：yauzl 解包 → word/document.xml 去标签
 * - pdf：zlib 解压 FlateDecode 流 → 提取 Tj/TJ 文本操作符（扫描件不可用）
 *
 * 提取失败抛错（上传路由转 400），绝不把二进制噪声写入知识库。
 */
import { inflateSync, inflateRawSync } from "node:zlib";
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);
// yauzl 是 server 直接依赖（官方 export 用），这里复用解包 docx；包无内建类型，用最小接口。
interface YauzlEntry {
  fileName: string;
}
interface YauzlZipFile {
  on(event: "entry", listener: (entry: YauzlEntry) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  openReadStream(
    entry: YauzlEntry,
    callback: (error: Error | null, stream?: NodeJS.ReadableStream) => void,
  ): unknown;
  readEntry(): void;
  close(): void;
}
const yauzl = nodeRequire("yauzl") as {
  open(
    path: string,
    options: Record<string, unknown>,
    callback: (error: Error | null, zipfile?: YauzlZipFile) => void,
  ): void;
};

/** 纯文本直读的扩展名白名单（小写、含点）。 */
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".mdx", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml",
  ".xml", ".html", ".htm", ".log", ".ini", ".conf", ".env",
  // 常见源码扩展（OpenWebUI TextLoader 同思路）
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs", ".java",
  ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".sh", ".bash", ".zsh", ".ps1",
  ".sql", ".toml", ".properties", ".vue", ".svelte", ".css", ".scss", ".less",
]);

export interface ExtractResult {
  text: string;
  /** 抽取引擎标识（写入事件日志便于排查）。 */
  engine: "text" | "docx" | "pdf";
}

export function extensionOf(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index).toLowerCase() : "";
}

/** UTF-8 直读（剥离 BOM，统一换行）。 */
function extractText(buffer: Buffer): string {
  return buffer.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
}

/** yauzl Promise 封装：读取 zip 内指定条目内容。 */
function readZipEntry(zipPath: string, entryName: string): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (error, zipfile) => {
      if (error || !zipfile) {
        reject(error ?? new Error("zip open failed"));
        return;
      }
      let settled = false;
      zipfile.on("entry", (entry: YauzlEntry) => {
        if (settled) return;
        if (entry.fileName === entryName) {
          zipfile.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              zipfile.close();
              reject(streamError ?? new Error("zip read stream failed"));
              return;
            }
            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("end", () => {
              settled = true;
              zipfile.close();
              resolve(Buffer.concat(chunks));
            });
          });
          return;
        }
        zipfile.readEntry();
      });
      zipfile.on("end", () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      });
      zipfile.on("error", (zipError: Error) => {
        if (!settled) {
          settled = true;
          reject(zipError);
        }
      });
      zipfile.readEntry();
    });
  });
}

/** docx：解包 word/document.xml，把 </w:p> 视为换行、去掉其余标签。 */
async function extractDocx(buffer: Buffer): Promise<string> {
  const { writeFile, unlink, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const tempPath = join(tmpdir(), `zcode-kb-${randomUUID()}.docx`);
  await writeFile(tempPath, buffer);
  try {
    const xml = await readZipEntry(tempPath, "word/document.xml");
    if (!xml) throw new Error("docx 缺少 word/document.xml");
    const content = xml.toString("utf8");
    const paragraphs = content
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "");
    const decoded = paragraphs
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    return decoded.replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

/** 从 PDF 内容流里提取文本操作符中的字符串（Tj / TJ / ' / "）。 */
function extractTextFromContentStream(stream: string): string {
  const out: string[] = [];
  // (...) Tj 与 [(...) -2 (...) ] TJ 两种形态；八进制转义与 \( 转义一并处理。
  const tokenRegex = /\((?:\\.|[^\\()])*\)|T\*|Td|TD|ET/g;
  let match: RegExpExecArray | null;
  let line = "";
  while ((match = tokenRegex.exec(stream))) {
    const token = match[0];
    if (token.startsWith("(")) {
      const raw = token.slice(1, -1);
      const decoded = raw
        .replace(/\\([nrtbf()\\])/g, (_, ch: string) => {
          switch (ch) {
            case "n": return "\n";
            case "r": return "\r";
            case "t": return "\t";
            case "b":
            case "f": return "";
            default: return ch;
          }
        })
        .replace(/\\([0-7]{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
      line += decoded;
    } else if (token === "T*" || token === "Td" || token === "TD" || token === "ET") {
      if (line.trim()) out.push(line.trim());
      line = "";
    }
  }
  if (line.trim()) out.push(line.trim());
  return out.join("\n");
}

/**
 * PDF 尽力提取：找所有 stream...endstream，优先 FlateDecode inflate，
 * 失败再试 raw inflate；能解压的内容里抓文本操作符。
 * 扫描件 / 加密件会得到极少文本 —— 由调用方按长度阈值拒绝。
 */
function extractPdf(buffer: Buffer): string {
  const latin = buffer.toString("latin1");
  const pieces: string[] = [];
  const streamRegex = /stream\r?\n?/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(latin))) {
    const start = match.index + match[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) break;
    const rawSlice = buffer.subarray(start, end);
    let decoded: string | null = null;
    try {
      decoded = inflateSync(rawSlice).toString("latin1");
    } catch {
      try {
        decoded = inflateRawSync(rawSlice).toString("latin1");
      } catch {
        decoded = null;
      }
    }
    if (decoded && /\((?:\\.|[^\\()])*\)\s*Tj|\bTJ\b/.test(decoded)) {
      pieces.push(extractTextFromContentStream(decoded));
    }
    streamRegex.lastIndex = end;
  }
  return pieces.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 统一入口：按扩展名路由到对应抽取器。 */
export async function extractDocumentText(filename: string, buffer: Buffer): Promise<ExtractResult> {
  const extension = extensionOf(filename);
  if (TEXT_EXTENSIONS.has(extension)) {
    const text = extractText(buffer);
    if (!text) throw new Error("文件为空或无法按 UTF-8 解码");
    return { text, engine: "text" };
  }
  if (extension === ".docx") {
    const text = await extractDocx(buffer);
    if (!text) throw new Error("docx 中未提取到文本");
    return { text, engine: "docx" };
  }
  if (extension === ".pdf") {
    const text = extractPdf(buffer);
    if (text.length < 20) {
      throw new Error("无法提取 PDF 文本（可能为扫描件或加密 PDF）");
    }
    return { text, engine: "pdf" };
  }
  // 无扩展名 / 未知类型：尝试按文本处理（内容含大量 NUL 则拒绝）。
  if (!extension && !buffer.subarray(0, 1024).includes(0)) {
    const text = extractText(buffer);
    if (text) return { text, engine: "text" };
  }
  throw new Error(`暂不支持该文件类型（${extension || "未知"}）：支持 txt/md/code/docx/pdf`);
}
