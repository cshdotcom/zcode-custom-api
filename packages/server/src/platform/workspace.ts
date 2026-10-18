import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { chunkDocument } from "./store.js";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

/**
 * 工作区资源存储（OpenWebUI workspace 模型完整移植）：
 *
 * - files：聊天/知识库共用上传文件管线（OpenWebUI POST /api/v1/files/ 对应）。
 *   原始文件落盘 uploads/{ownerId}/{fileId}_{safeName}，抽取文本入库（复用
 *   extract.ts 抽取 + chunkDocument 分块），knowledge 关联时按需建 FTS 索引。
 * - kb_collections：知识库（OpenWebUI knowledge collection 对应）。
 *   一座知识库聚合多个文件；文件入集时建 kb_docs 影子行（带 collection_id 列），
 *   agent 经既有 /api/platform/kb/search 与 platform-knowledge MCP 无感检索。
 * - 每用户隔离：所有查询按 owner_id 过滤（admin 旁路可见全部，OpenWebUI
 *   BYPASS_ADMIN_ACCESS_CONTROL 同款语义）。
 *
 * 与既有 kb_docs 扁平上传（旧 UI / 兼容端点）共存：影子行 owner 与集合 owner
 * 一致，检索结果按用户隔离语义天然合并。
 */

export interface WorkspaceFile {
  id: string;
  ownerId: string;
  ownerUsername?: string;
  filename: string;
  size: number;
  hash?: string;
  /** 抽取后的纯文本（供编辑器回显与集合索引）。 */
  content?: string;
  status: "completed" | "failed";
  error?: string;
  /** 上传方自定义元数据（knowledgeId、collectionId、聊天上下文等）。 */
  meta?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceCollection {
  id: string;
  ownerId: string;
  ownerUsername?: string;
  name: string;
  description?: string;
  fileCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CollectionFile {
  fileId: string;
  filename: string;
  size: number;
  status: "completed" | "failed";
  chunkCount: number;
  addedBy?: string;
  addedByUsername?: string;
  addedAt: number;
  fileCreatedAt: number;
}

export interface WorkspaceFileHit {
  docId: string;
  docTitle: string;
  snippet: string;
  collectionId?: string;
  collectionName?: string;
  fileId?: string;
}

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 4_000_000;

export class WorkspaceStore {
  readonly #db: InstanceType<typeof DatabaseSync>;
  readonly #dataDir: string;
  #ftsEnabled = false;

  constructor(dataDir: string) {
    this.#dataDir = dataDir;
    mkdirSync(this.uploadsRoot, { recursive: true });
    this.#db = new DatabaseSync(join(dataDir, "users.db"), {
      open: true,
    });
    this.#db.exec("PRAGMA journal_mode = WAL;");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        path TEXT,
        content TEXT,
        hash TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'completed',
        error TEXT,
        meta TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_files_user ON files (user_id);
      CREATE TABLE IF NOT EXISTS kb_collections (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_collections_owner ON kb_collections (owner_id);
      CREATE TABLE IF NOT EXISTS kb_collection_files (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL,
        file_id TEXT NOT NULL,
        added_by TEXT,
        kb_doc_id TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (collection_id, file_id)
      );
      CREATE INDEX IF NOT EXISTS idx_kb_collection_files_col ON kb_collection_files (collection_id);
      CREATE INDEX IF NOT EXISTS idx_kb_collection_files_file ON kb_collection_files (file_id);
    `);
    // 旧库补列：kb_docs.collection_id（影子行回链集合；旧扁平文档为 NULL）。
    for (const column of ["collection_id TEXT", "file_id TEXT"]) {
      try {
        this.#db.exec(`ALTER TABLE kb_docs ADD COLUMN ${column};`);
      } catch {
        // 已存在则忽略（幂等迁移）。
      }
    }
    try {
      this.#db.exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(content, doc_id UNINDEXED);",
      );
      this.#ftsEnabled = true;
    } catch {
      this.#ftsEnabled = false;
    }
  }

  get uploadsRoot(): string {
    return join(this.#dataDir, "uploads");
  }

  // ================= 文件上传管线（OpenWebUI /api/v1/files 对应） =================

  /**
   * 创建文件：原始字节落盘（扁平 {uuid}_{safeName}，OpenWebUI 同款），
   * 抽取文本由调用方传入（失败时 status=failed，文件仍保留供重试/下载）。
   */
  createFile(input: {
    ownerId: string;
    filename: string;
    buffer: Buffer;
    content?: string;
    error?: string;
    contentType?: string;
    meta?: Record<string, unknown>;
  }): WorkspaceFile {
    const safeName = input.filename.replace(/[/\\]/g, "_").slice(0, 260) || "untitled";
    if (input.buffer.length > MAX_FILE_BYTES) {
      throw new Error("文件过大（上限 20MB）");
    }
    const id = `f_${randomBytes(9).toString("hex")}`;
    const ownerDir = join(this.uploadsRoot, input.ownerId);
    mkdirSync(ownerDir, { recursive: true });
    const diskName = `${id}_${safeName}`;
    const diskPath = join(ownerDir, diskName);
    writeFileSync(diskPath, input.buffer);
    const content = input.content ?? "";
    if (content.length > MAX_TEXT_CHARS) {
      throw new Error("提取后的文本超过 4MB 上限，请拆分文件");
    }
    const now = Date.now();
    this.#db
      .prepare(
        `INSERT INTO files (id, user_id, filename, path, content, hash, size, status, error, meta, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.ownerId,
        safeName,
        diskPath,
        content || null,
        createHash("sha256").update(content || "").digest("hex"),
        input.buffer.length,
        input.error ? "failed" : "completed",
        input.error ?? null,
        input.meta ? JSON.stringify(input.meta) : null,
        now,
        now,
      );
    return this.#getFileOrThrow(id);
  }

  listFiles(options?: { ownerId?: string; limit?: number }): WorkspaceFile[] {
    const scoped = Boolean(options?.ownerId);
    const limit = Math.min(options?.limit ?? 200, 1000);
    const rows = (
      this.#db
        .prepare(
          `SELECT f.*, u.username AS owner_username FROM files f
           LEFT JOIN users u ON u.id = f.user_id
           ${scoped ? "WHERE f.user_id = ?" : ""}
           ORDER BY f.created_at DESC LIMIT ?`,
        )
        .all(...(scoped ? [options!.ownerId!] : []), limit) as unknown as FileRow[]
    ).map((row) => this.#rowToFile(row));
    return rows;
  }

  getFile(id: string, viewer: { id: string; role: string }): WorkspaceFile | undefined {
    const row = this.#getFileRow(id);
    if (!row) return undefined;
    if (row.user_id !== viewer.id && viewer.role !== "admin") return undefined;
    return this.#rowToFile(row);
  }

  getFileText(id: string, viewer: { id: string; role: string }): string | undefined {
    const file = this.getFile(id, viewer);
    if (!file || file.status !== "completed") return undefined;
    return file.content;
  }

  /** 读取原始文件字节（下载端点用）。 */
  readFileBuffer(id: string, viewer: { id: string; role: string }): { buffer: Buffer; filename: string } | undefined {
    const row = this.#getFileRow(id);
    if (!row) return undefined;
    if (row.user_id !== viewer.id && viewer.role !== "admin") return undefined;
    if (!row.path) return undefined;
    try {
      return { buffer: readFileSync(row.path), filename: row.filename };
    } catch {
      return undefined;
    }
  }

  /** 更新抽取文本（编辑器保存）：重建集合影子行的 FTS 索引。 */
  updateFileContent(id: string, viewer: { id: string; role: string }, content: string): WorkspaceFile {
    const row = this.#getFileRow(id);
    if (!row) throw new Error("文件不存在");
    if (row.user_id !== viewer.id && viewer.role !== "admin") throw new Error("无权修改该文件");
    if (content.length > MAX_TEXT_CHARS) throw new Error("文本超过 4MB 上限");
    this.#db
      .prepare(
        "UPDATE files SET content = ?, hash = ?, status = 'completed', error = NULL, updated_at = ? WHERE id = ?",
      )
      .run(content, createHash("sha256").update(content).digest("hex"), Date.now(), id);
    // 同步重建引用该文件的集合索引（OpenWebUI /files/{id}/data/content/update 同语义）。
    const links = this.#db
      .prepare("SELECT collection_id, kb_doc_id FROM kb_collection_files WHERE file_id = ?")
      .all(id) as Array<{ collection_id: string; kb_doc_id: string | null }>;
    for (const link of links) {
      if (link.kb_doc_id) this.#reindexShadowDoc(link.kb_doc_id, content);
    }
    return this.#getFileOrThrow(id);
  }

  deleteFile(id: string, viewer: { id: string; role: string }): boolean {
    const row = this.#getFileRow(id);
    if (!row) return false;
    if (row.user_id !== viewer.id && viewer.role !== "admin") throw new Error("无权删除该文件");
    // 级联：集合关联 + 影子文档（chunks/FTS）+ 磁盘文件。
    const links = this.#db
      .prepare("SELECT kb_doc_id FROM kb_collection_files WHERE file_id = ?")
      .all(id) as Array<{ kb_doc_id: string | null }>;
    this.#db.exec("BEGIN");
    try {
      for (const link of links) {
        if (link.kb_doc_id) this.#deleteShadowDoc(link.kb_doc_id);
      }
      this.#db.prepare("DELETE FROM kb_collection_files WHERE file_id = ?").run(id);
      this.#db.prepare("DELETE FROM files WHERE id = ?").run(id);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    if (row.path) {
      try {
        unlinkSync(row.path);
      } catch {
        // 磁盘清理失败不阻断返回（孤儿文件可由运维清理）。
      }
    }
    return true;
  }

  // ================= 知识库集合（OpenWebUI knowledge 对应） =================

  createCollection(input: { ownerId: string; name: string; description?: string }): WorkspaceCollection {
    const name = input.name.trim().slice(0, 200);
    if (!name) throw new Error("知识库名称不能为空");
    const id = `kbcol_${randomBytes(9).toString("hex")}`;
    const now = Date.now();
    this.#db
      .prepare(
        "INSERT INTO kb_collections (id, owner_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, input.ownerId, name, input.description?.trim().slice(0, 1000) ?? null, now, now);
    return this.#getCollectionOrThrow(id);
  }

  /** 列表（view: created=我建的 / shared=他人的；admin 未过滤时也允许按 view 过滤）。 */
  listCollections(options?: {
    ownerId?: string;
    userId?: string;
    query?: string;
    view?: "created" | "shared";
  }): WorkspaceCollection[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    // 可见性：owner 恒可见；admin 旁路（未传 ownerId）时若指定 view 再过滤。
    if (options?.ownerId) {
      if (options.view === "created") {
        clauses.push("c.owner_id = ?");
        params.push(options.ownerId);
      } else if (options.view === "shared") {
        clauses.push("c.owner_id != ?");
        params.push(options.ownerId);
      } else {
        clauses.push("c.owner_id = ?");
        params.push(options.ownerId);
      }
    }
    const query = options?.query?.trim();
    if (query) {
      clauses.push("(c.name LIKE ? OR c.description LIKE ?)");
      const like = `%${query.replace(/[%_]/g, " ")}%`;
      params.push(like, like);
    }
    const rows = (
      this.#db
        .prepare(
          `SELECT c.*, u.username AS owner_username,
             (SELECT COUNT(*) FROM kb_collection_files cf WHERE cf.collection_id = c.id) AS file_count
           FROM kb_collections c LEFT JOIN users u ON u.id = c.owner_id
           ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
           ORDER BY c.updated_at DESC`,
        )
        .all(...params) as unknown as CollectionRow[]
    ).map((row) => this.#rowToCollection(row));
    return rows;
  }

  getCollection(id: string, viewer: { id: string; role: string }): WorkspaceCollection | undefined {
    const row = this.#getCollectionRow(id);
    if (!row) return undefined;
    if (row.owner_id !== viewer.id && viewer.role !== "admin") return undefined;
    return this.#rowToCollection(row);
  }

  updateCollection(
    id: string,
    viewer: { id: string; role: string },
    patch: { name?: string; description?: string },
  ): WorkspaceCollection {
    const row = this.#getCollectionRow(id);
    if (!row) throw new Error("知识库不存在");
    if (row.owner_id !== viewer.id && viewer.role !== "admin") throw new Error("无权修改该知识库");
    const name = patch.name !== undefined ? patch.name.trim().slice(0, 200) || row.name : row.name;
    const description =
      patch.description !== undefined ? patch.description.trim().slice(0, 1000) : row.description;
    this.#db
      .prepare("UPDATE kb_collections SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(name, description ?? null, Date.now(), id);
    // 名称变更同步影子文档标题前缀。
    const links = this.#db
      .prepare(
        "SELECT cf.kb_doc_id AS doc_id, f.filename AS filename FROM kb_collection_files cf JOIN files f ON f.id = cf.file_id WHERE cf.collection_id = ?",
      )
      .all(id) as Array<{ doc_id: string | null; filename: string }>;
    for (const link of links) {
      if (link.doc_id) {
        this.#db
          .prepare("UPDATE kb_docs SET title = ? WHERE id = ?")
          .run(this.#shadowDocTitle(name, link.filename), link.doc_id);
      }
    }
    return this.#getCollectionOrThrow(id);
  }

  deleteCollection(id: string, viewer: { id: string; role: string }): boolean {
    const row = this.#getCollectionRow(id);
    if (!row) return false;
    if (row.owner_id !== viewer.id && viewer.role !== "admin") throw new Error("无权删除该知识库");
    const links = this.#db
      .prepare("SELECT kb_doc_id FROM kb_collection_files WHERE collection_id = ?")
      .all(id) as Array<{ kb_doc_id: string | null }>;
    this.#db.exec("BEGIN");
    try {
      for (const link of links) {
        if (link.kb_doc_id) this.#deleteShadowDoc(link.kb_doc_id);
      }
      this.#db.prepare("DELETE FROM kb_collection_files WHERE collection_id = ?").run(id);
      this.#db.prepare("DELETE FROM kb_collections WHERE id = ?").run(id);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return true;
  }

  /** 集合文件列表（OpenWebUI GET /knowledge/{id}/files 对应）。 */
  listCollectionFiles(collectionId: string, viewer: { id: string; role: string }): CollectionFile[] {
    const row = this.#getCollectionRow(collectionId);
    if (!row) throw new Error("知识库不存在");
    if (row.owner_id !== viewer.id && viewer.role !== "admin") throw new Error("无权读取该知识库");
    const rows = (
      this.#db
        .prepare(
          `SELECT f.id AS file_id, f.filename, f.size, f.status, f.created_at AS file_created_at,
                  cf.added_by, cf.created_at AS added_at, u2.username AS added_by_username,
                  d.chunk_count AS chunk_count
           FROM kb_collection_files cf
           JOIN files f ON f.id = cf.file_id
           LEFT JOIN users u2 ON u2.id = cf.added_by
           LEFT JOIN kb_docs d ON d.id = cf.kb_doc_id
           WHERE cf.collection_id = ?
           ORDER BY cf.created_at DESC`,
        )
        .all(collectionId) as Array<{
        file_id: string;
        filename: string;
        size: number;
        status: string;
        chunk_count: number | null;
        file_created_at: number;
        added_by: string | null;
        added_at: number;
        added_by_username: string | null;
      }>
    ).map((row) => ({
      fileId: row.file_id,
      filename: row.filename,
      size: Number(row.size),
      status: row.status === "failed" ? ("failed" as const) : ("completed" as const),
      chunkCount: Number(row.chunk_count ?? 0),
      ...(row.added_by ? { addedBy: row.added_by } : {}),
      ...(row.added_by_username ? { addedByUsername: row.added_by_username } : {}),
      addedAt: Number(row.added_at),
      fileCreatedAt: Number(row.file_created_at),
    }));
    return rows;
  }

  /**
   * 文件加入集合：复用已抽取文本建影子 kb_doc（分块 + FTS 索引），
   * agent 侧既有检索链路（/api/platform/kb/search、platform-knowledge MCP）即时可见。
   */
  addFileToCollection(
    collectionId: string,
    fileId: string,
    viewer: { id: string; role: string },
  ): CollectionFile {
    const col = this.#getCollectionRow(collectionId);
    if (!col) throw new Error("知识库不存在");
    if (col.owner_id !== viewer.id && viewer.role !== "admin") throw new Error("无权写入该知识库");
    const file = this.#getFileRow(fileId);
    if (!file) throw new Error("文件不存在");
    if (file.status !== "completed" || !file.content?.trim()) {
      throw new Error("文件尚未完成文本抽取，无法加入知识库");
    }
    const dup = this.#db
      .prepare("SELECT id FROM kb_collection_files WHERE collection_id = ? AND file_id = ?")
      .get(collectionId, fileId) as { id: string } | undefined;
    if (dup) throw new Error("文件已在该知识库中");
    const linkId = `kbcf_${randomBytes(9).toString("hex")}`;
    const now = Date.now();
    this.#db.exec("BEGIN");
    try {
      const kbDocId = `kb_${randomBytes(9).toString("hex")}`;
      const title = this.#shadowDocTitle(col.name, file.filename);
      this.#db
        .prepare(
          `INSERT INTO kb_docs (id, title, filename, size, chunk_count, owner_id, created_at, collection_id, file_id)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        )
        .run(kbDocId, title, file.filename, Number(file.size), col.owner_id, now, collectionId, fileId);
      this.#indexShadowDoc(kbDocId, file.content);
      this.#db
        .prepare(
          "INSERT INTO kb_collection_files (id, collection_id, file_id, added_by, kb_doc_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(linkId, collectionId, fileId, viewer.id, kbDocId, now);
      this.#db
        .prepare("UPDATE kb_collections SET updated_at = ? WHERE id = ?")
        .run(now, collectionId);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return this.listCollectionFiles(collectionId, viewer).find((item) => item.fileId === fileId)!;
  }

  /** 从集合移除文件（deleteFile=false 时保留文件本体，OpenWebUI query 语义）。 */
  removeFileFromCollection(
    collectionId: string,
    fileId: string,
    viewer: { id: string; role: string },
    deleteFile = false,
  ): boolean {
    const col = this.#getCollectionRow(collectionId);
    if (!col) return false;
    if (col.owner_id !== viewer.id && viewer.role !== "admin") throw new Error("无权写入该知识库");
    const link = this.#db
      .prepare("SELECT id, kb_doc_id FROM kb_collection_files WHERE collection_id = ? AND file_id = ?")
      .get(collectionId, fileId) as { id: string; kb_doc_id: string | null } | undefined;
    if (!link) return false;
    this.#db.exec("BEGIN");
    try {
      if (link.kb_doc_id) this.#deleteShadowDoc(link.kb_doc_id);
      this.#db.prepare("DELETE FROM kb_collection_files WHERE id = ?").run(link.id);
      this.#db
        .prepare("UPDATE kb_collections SET updated_at = ? WHERE id = ?")
        .run(Date.now(), collectionId);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    if (deleteFile) {
      this.deleteFile(fileId, viewer);
    }
    return true;
  }

  /** 知识库内检索（带集合上下文的命中）。 */
  searchCollections(
    query: string,
    viewer: { id: string; role: string },
    options?: { collectionId?: string; limit?: number },
  ): WorkspaceFileHit[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const limit = Math.min(options?.limit ?? 8, 50);
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (viewer.role !== "admin") {
      clauses.push("c.owner_id = ?");
      params.push(viewer.id);
    }
    if (options?.collectionId) {
      clauses.push("c.id = ?");
      params.push(options.collectionId);
    }
    const scope = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const like = `%${trimmed.replace(/[%_]/g, " ")}%`;
    const rows = (
      this.#db
        .prepare(
          `SELECT d.id AS doc_id, d.title AS doc_title, c2.content AS content,
                  c.id AS collection_id, c.name AS collection_name, cf.file_id AS file_id
           FROM kb_collection_files cf
           JOIN kb_collections c ON c.id = cf.collection_id
           JOIN kb_docs d ON d.id = cf.kb_doc_id
           JOIN kb_chunks c2 ON c2.doc_id = d.id
           ${scope}
           AND c2.content LIKE ?
           LIMIT ?`,
        )
        .all(...params, like, limit) as Array<{
        doc_id: string;
        doc_title: string;
        content: string;
        collection_id: string;
        collection_name: string;
        file_id: string;
      }>
    ).map((row) => ({
      docId: row.doc_id,
      docTitle: row.doc_title,
      snippet: row.content.slice(0, 240),
      collectionId: row.collection_id,
      collectionName: row.collection_name,
      fileId: row.file_id,
    }));
    return rows;
  }

  // ================= 内部工具 =================

  #getFileRow(id: string): FileRow | undefined {
    return this.#db.prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRow | undefined;
  }

  #getFileOrThrow(id: string): WorkspaceFile {
    const row = this.#getFileRow(id);
    if (!row) throw new Error("文件不存在");
    return this.#rowToFile(row);
  }

  #rowToFile(row: FileRow): WorkspaceFile {
    let meta: Record<string, unknown> | undefined;
    if (row.meta) {
      try {
        const parsed: unknown = JSON.parse(row.meta);
        if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
      } catch {
        // 损坏的 meta 忽略。
      }
    }
    return {
      id: row.id,
      ownerId: row.user_id,
      ...(row.owner_username ? { ownerUsername: row.owner_username } : {}),
      filename: row.filename,
      size: Number(row.size),
      ...(row.hash ? { hash: row.hash } : {}),
      ...(row.content ? { content: row.content } : {}),
      status: row.status === "failed" ? "failed" : "completed",
      ...(row.error ? { error: row.error } : {}),
      ...(meta ? { meta } : {}),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  #getCollectionRow(id: string): CollectionRow | undefined {
    return this.#db.prepare("SELECT * FROM kb_collections WHERE id = ?").get(id) as
      | CollectionRow
      | undefined;
  }

  #getCollectionOrThrow(id: string): WorkspaceCollection {
    const row = this.#getCollectionRow(id);
    if (!row) throw new Error("知识库不存在");
    return this.#rowToCollection(row);
  }

  #rowToCollection(row: CollectionRow): WorkspaceCollection {
    return {
      id: row.id,
      ownerId: row.owner_id,
      ...(row.owner_username ? { ownerUsername: row.owner_username } : {}),
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      fileCount: Number(row.file_count ?? 0),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  #shadowDocTitle(collectionName: string, filename: string): string {
    return `${collectionName} / ${filename}`.slice(0, 200);
  }

  #indexShadowDoc(kbDocId: string, content: string): void {
    const chunks = chunkDocument(content);
    const insertChunk = this.#db.prepare(
      "INSERT INTO kb_chunks (id, doc_id, ord, content) VALUES (?, ?, ?, ?)",
    );
    const insertFts = this.#ftsEnabled
      ? this.#db.prepare("INSERT INTO kb_fts (content, doc_id) VALUES (?, ?)")
      : null;
    chunks.forEach((chunk, index) => {
      insertChunk.run(`kbc_${randomBytes(8).toString("hex")}`, kbDocId, index, chunk);
      insertFts?.run(chunk, kbDocId);
    });
    this.#db
      .prepare("UPDATE kb_docs SET chunk_count = ? WHERE id = ?")
      .run(chunks.length, kbDocId);
  }

  #reindexShadowDoc(kbDocId: string, content: string): void {
    this.#db.exec("BEGIN");
    try {
      if (this.#ftsEnabled) {
        this.#db.prepare("DELETE FROM kb_fts WHERE doc_id = ?").run(kbDocId);
      }
      this.#db.prepare("DELETE FROM kb_chunks WHERE doc_id = ?").run(kbDocId);
      this.#indexShadowDoc(kbDocId, content);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #deleteShadowDoc(kbDocId: string): void {
    if (this.#ftsEnabled) {
      this.#db.prepare("DELETE FROM kb_fts WHERE doc_id = ?").run(kbDocId);
    }
    this.#db.prepare("DELETE FROM kb_chunks WHERE doc_id = ?").run(kbDocId);
    this.#db.prepare("DELETE FROM kb_docs WHERE id = ?").run(kbDocId);
  }
}

interface FileRow {
  id: string;
  user_id: string;
  owner_username?: string | null;
  filename: string;
  path: string | null;
  content: string | null;
  hash: string | null;
  size: number;
  status: string;
  error: string | null;
  meta: string | null;
  created_at: number;
  updated_at: number;
}

interface CollectionRow {
  id: string;
  owner_id: string;
  owner_username?: string | null;
  name: string;
  description: string | null;
  file_count?: number;
  created_at: number;
  updated_at: number;
}
