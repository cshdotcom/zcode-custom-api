import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// tsup/esbuild 会把 import("node:sqlite") 改写为 import("sqlite")，运行时报
// ERR_MODULE_NOT_FOUND；createRequire 稳定保留 node: 协议（同 platform/store.ts）。
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

/**
 * 分享快照生成器：只读访问 ZCode 自身的 SQLite 存储，把对话 / 任务 / 项目
 * 序列化为可公开渲染的快照 JSON。
 *
 * 数据源（与官方服务一致）：
 * - 会话与消息：{dataRoot}/cli/db/db.sqlite（session/message/part 表；
 *   任务的 task_id 就是 session id，因此任务与对话共用同一份 transcript）
 * - 任务/项目元数据：{configDir}/tasks-index.sqlite（tasks/task_groups/task_group_members）
 *
 * 快照式设计（OpenWebUI shared_chats 同款）：分享时落盘，后续编辑不影响已分享内容。
 */

const MAX_PART_TEXT_CHARS = 8_000;
const MAX_PARTS = 800;

export interface ShareTranscriptRow {
  role: "user" | "assistant";
  text: string;
  tools?: string[];
  reasoning?: string;
  time: number;
}

export interface SessionSnapshot {
  type: "transcript";
  sessionId: string;
  title: string;
  directory?: string;
  model?: string;
  messageCount: number;
  rows: ShareTranscriptRow[];
  generatedAt: number;
}

export interface TaskMeta {
  taskId: string;
  title: string;
  status: string;
  workspacePath?: string;
  model?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface TaskSnapshot {
  type: "task";
  task: TaskMeta;
  transcript: SessionSnapshot | null;
  generatedAt: number;
}

export interface ProjectSnapshot {
  type: "project";
  groupId: string;
  title: string;
  color?: string;
  tasks: TaskMeta[];
  generatedAt: number;
}

export type ShareSnapshot = SessionSnapshot | TaskSnapshot | ProjectSnapshot;

export class ZcodeDataSnapshotReader {
  readonly #cliDbPath: string;
  readonly #tasksIndexPath: string;

  constructor(configDir: string) {
    // configDir = {dataRoot}/v2；cli 数据在 {dataRoot}/cli/db/db.sqlite
    const dataRoot = dirname(configDir);
    this.#cliDbPath = join(dataRoot, "cli", "db", "db.sqlite");
    this.#tasksIndexPath = join(configDir, "tasks-index.sqlite");
  }

  get available(): { sessions: boolean; tasks: boolean } {
    return {
      sessions: existsSync(this.#cliDbPath),
      tasks: existsSync(this.#tasksIndexPath),
    };
  }

  // ================= 列表（分享中心资源选择器用） =================

  listSessions(limit = 200): Array<{
    id: string;
    title: string;
    projectId?: string;
    updatedAt: number;
    messageCount: number;
  }> {
    if (!existsSync(this.#cliDbPath)) return [];
    const db = new DatabaseSync(this.#cliDbPath, { readOnly: true });
    try {
      const rows = db
        .prepare(
          `SELECT s.id, s.title, s.project_id, s.time_updated,
                  (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS message_count
           FROM session s
           WHERE s.parent_id IS NULL
           ORDER BY s.time_updated DESC LIMIT ?`,
        )
        .all(limit) as Array<{
        id: string;
        title: string;
        project_id: string | null;
        time_updated: number;
        message_count: number;
      }>;
      return rows
        .filter((r) => Number(r.message_count) > 0)
        .map((r) => ({
          id: r.id,
          title: r.title || "(未命名会话)",
          ...(r.project_id ? { projectId: r.project_id } : {}),
          updatedAt: Number(r.time_updated),
          messageCount: Number(r.message_count),
        }));
    } finally {
      db.close();
    }
  }

  listTasks(limit = 200): TaskMeta[] {
    if (!existsSync(this.#tasksIndexPath)) return [];
    const db = new DatabaseSync(this.#tasksIndexPath, { readOnly: true });
    try {
      const rows = db
        .prepare(
          "SELECT task_id, title, task_status, workspace_path, created_at, updated_at, meta_json FROM tasks WHERE deleted = 0 ORDER BY updated_at DESC LIMIT ?",
        )
        .all(limit) as Array<{
        task_id: string;
        title: string;
        task_status: string;
        workspace_path: string | null;
        created_at: number;
        updated_at: number;
        meta_json: string | null;
      }>;
      return rows.map((r) => this.#taskMetaFromRow(r));
    } finally {
      db.close();
    }
  }

  listProjects(limit = 100): Array<{
    groupId: string;
    title: string;
    color?: string;
    taskCount: number;
  }> {
    if (!existsSync(this.#tasksIndexPath)) return [];
    const db = new DatabaseSync(this.#tasksIndexPath, { readOnly: true });
    try {
      const rows = db
        .prepare(
          `SELECT g.group_id, g.title, g.color,
                  (SELECT COUNT(*) FROM task_group_members m WHERE m.group_id = g.group_id) AS task_count
           FROM task_groups g ORDER BY g.updated_at DESC LIMIT ?`,
        )
        .all(limit) as Array<{
        group_id: string;
        title: string;
        color: string | null;
        task_count: number;
      }>;
      return rows.map((r) => ({
        groupId: r.group_id,
        title: r.title,
        ...(r.color ? { color: r.color } : {}),
        taskCount: Number(r.task_count),
      }));
    } finally {
      db.close();
    }
  }

  #taskMetaFromRow(r: {
    task_id: string;
    title: string;
    task_status: string;
    workspace_path: string | null;
    created_at: number;
    updated_at: number;
    meta_json: string | null;
  }): TaskMeta {
    let model: string | undefined;
    try {
      if (r.meta_json) {
        const meta = JSON.parse(r.meta_json) as { model?: string; provider?: string };
        if (meta.model) model = meta.model;
      }
    } catch {
      // meta_json 非法时忽略 model 字段即可
    }
    return {
      taskId: r.task_id,
      title: r.title || "(未命名任务)",
      status: r.task_status,
      ...(r.workspace_path ? { workspacePath: r.workspace_path } : {}),
      ...(model ? { model } : {}),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }

  // ================= 快照 =================

  getSessionSnapshot(sessionId: string): SessionSnapshot | null {
    if (!existsSync(this.#cliDbPath)) return null;
    const db = new DatabaseSync(this.#cliDbPath, { readOnly: true });
    try {
      const session = db.prepare("SELECT * FROM session WHERE id = ?").get(sessionId) as
        | {
            id: string;
            title: string;
            directory: string | null;
            parent_id: string | null;
          }
        | undefined;
      if (!session) return null;
      const messages = db
        .prepare("SELECT id, data, sequence FROM message WHERE session_id = ? ORDER BY sequence ASC")
        .all(sessionId) as Array<{ id: string; data: string; sequence: number }>;
      const rows: ShareTranscriptRow[] = [];
      let model: string | undefined;
      for (const message of messages.slice(0, MAX_PARTS)) {
        let parsed: {
          role?: string;
          modelId?: string;
          providerId?: string;
          time?: { created?: number };
        };
        try {
          parsed = JSON.parse(message.data);
        } catch {
          continue;
        }
        const role = parsed.role;
        if (role !== "user" && role !== "assistant") continue;
        if (!model && role === "assistant" && parsed.modelId) {
          model = parsed.providerId ? `${parsed.providerId}/${parsed.modelId}` : parsed.modelId;
        }
        const parts = db
          .prepare("SELECT data FROM part WHERE message_id = ? ORDER BY sequence ASC")
          .all(message.id) as Array<{ data: string }>;
        const texts: string[] = [];
        const tools: string[] = [];
        let reasoning = "";
        for (const part of parts) {
          let data: { type?: string; text?: string; tool?: string; state?: { input?: Record<string, unknown> } };
          try {
            data = JSON.parse(part.data);
          } catch {
            continue;
          }
          if (data.type === "text" && data.text?.trim()) {
            texts.push(data.text.trim().slice(0, MAX_PART_TEXT_CHARS));
          } else if (data.type === "reasoning" && data.text?.trim()) {
            reasoning = data.text.trim().slice(0, 1_500);
          } else if (data.type === "tool" && data.tool) {
            const input = data.state?.input ?? {};
            const detail =
              (typeof input.file_path === "string" && input.file_path) ||
              (typeof input.command === "string" && input.command.slice(0, 80)) ||
              (typeof input.url === "string" && input.url) ||
              (typeof input.query === "string" && input.query) ||
              (typeof input.pattern === "string" && input.pattern) ||
              "";
            tools.push(detail ? `${data.tool}(${detail.slice(0, 80)})` : data.tool);
          }
        }
        const text = texts.join("\n\n");
        if (!text && tools.length === 0) continue;
        rows.push({
          role,
          text,
          ...(tools.length > 0 ? { tools } : {}),
          ...(reasoning ? { reasoning } : {}),
          time: Number(parsed.time?.created ?? 0),
        });
      }
      if (rows.length === 0) return null;
      return {
        type: "transcript",
        sessionId: session.id,
        title: session.title || "(未命名会话)",
        ...(session.directory ? { directory: session.directory } : {}),
        ...(model ? { model } : {}),
        messageCount: rows.length,
        rows,
        generatedAt: Date.now(),
      };
    } finally {
      db.close();
    }
  }

  getTaskSnapshot(taskId: string): TaskSnapshot | null {
    if (!existsSync(this.#tasksIndexPath)) return null;
    const db = new DatabaseSync(this.#tasksIndexPath, { readOnly: true });
    let meta: TaskMeta | null = null;
    try {
      const row = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId) as
        | {
            task_id: string;
            title: string;
            task_status: string;
            workspace_path: string | null;
            created_at: number;
            updated_at: number;
            meta_json: string | null;
          }
        | undefined;
      if (row) meta = this.#taskMetaFromRow(row);
    } finally {
      db.close();
    }
    const transcript = this.getSessionSnapshot(taskId);
    if (!meta && !transcript) return null;
    return {
      type: "task",
      task:
        meta ??
        ({
          taskId,
          title: transcript?.title ?? "(任务)",
          status: "unknown",
        } as TaskMeta),
      transcript,
      generatedAt: Date.now(),
    };
  }

  getProjectSnapshot(groupId: string): ProjectSnapshot | null {
    if (!existsSync(this.#tasksIndexPath)) return null;
    const db = new DatabaseSync(this.#tasksIndexPath, { readOnly: true });
    try {
      const group = db.prepare("SELECT * FROM task_groups WHERE group_id = ?").get(groupId) as
        | { group_id: string; title: string; color: string | null }
        | undefined;
      if (!group) return null;
      const members = db
        .prepare(
          `SELECT t.task_id, t.title, t.task_status, t.workspace_path, t.created_at, t.updated_at, t.meta_json
           FROM task_group_members m JOIN tasks t ON t.task_id = m.task_id
           WHERE m.group_id = ? AND t.deleted = 0
           ORDER BY m.sort_order ASC LIMIT 300`,
        )
        .all(groupId) as Array<{
        task_id: string;
        title: string;
        task_status: string;
        workspace_path: string | null;
        created_at: number;
        updated_at: number;
        meta_json: string | null;
      }>;
      return {
        type: "project",
        groupId: group.group_id,
        title: group.title,
        ...(group.color ? { color: group.color } : {}),
        tasks: members.map((r) => this.#taskMetaFromRow(r)),
        generatedAt: Date.now(),
      };
    } finally {
      db.close();
    }
  }

  /** 生成资源快照的统一入口；资源不存在返回 null。 */
  snapshot(resourceType: "session" | "task" | "project", resourceId: string): ShareSnapshot | null {
    switch (resourceType) {
      case "session":
        return this.getSessionSnapshot(resourceId);
      case "task":
        return this.getTaskSnapshot(resourceId);
      case "project":
        return this.getProjectSnapshot(resourceId);
    }
  }
}
