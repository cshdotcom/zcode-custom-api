/**
 * 平台公开分享落地页（/s/:token）：SSR + og: meta。
 * 登录页、管理控制台、分享中心已深度融合为 SPA 内原生界面
 * （packages/web 登录门 + packages/ui 设置页「平台中心」「平台管理」分区），
 * 服务端仅保留面向外部访客的分享落地页这一种自渲染页面。
 */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderTranscriptRows(rows: Array<{ role: string; text: string; tools?: string[]; reasoning?: string; time?: number }>): string {
  return rows
    .map((row) => {
      const isUser = row.role === "user";
      const bubble = isUser
        ? "background:#1f6feb22;border:1px solid #1f6feb55;"
        : "background:#161b22;border:1px solid #30363d;";
      const who = isUser ? "用户" : "助手";
      const time = row.time ? new Date(Number(row.time)).toLocaleString("zh-CN") : "";
      const reasoning = row.reasoning
        ? `<details style="margin-top:6px"><summary style="cursor:pointer;color:#8b949e;font-size:12px">思考过程</summary><div style="color:#8b949e;font-size:12px;white-space:pre-wrap;margin-top:4px">${escapeHtml(row.reasoning)}</div></details>`
        : "";
      const tools =
        row.tools && row.tools.length > 0
          ? `<div style="margin-top:8px;font-size:12px;color:#8b949e">工具调用：${row.tools.map((t) => `<code>${escapeHtml(t)}</code>`).join(" ")}</div>`
          : "";
      return `<div style="margin:14px 0">
  <div style="font-size:12px;color:#8b949e;margin-bottom:4px">${who}${time ? " · " + time : ""}</div>
  <div style="${bubble}border-radius:10px;padding:12px 14px;white-space:pre-wrap;word-break:break-word;line-height:1.7">${escapeHtml(row.text || "（无文本内容）")}${reasoning}${tools}</div>
</div>`;
    })
    .join("\n");
}

function typeLabel(type: string): string {
  return type === "session" ? "对话" : type === "task" ? "任务" : "项目";
}

export function shareViewPageHtml(share: {
  token: string;
  title: string;
  resourceType: string;
  visibility: string;
  ownerUsername?: string;
  viewCount: number;
  createdAt: number;
  snapshot: unknown;
}): string {
  const snapshot = share.snapshot as
    | {
        type?: string;
        title?: string;
        directory?: string;
        model?: string;
        messageCount?: number;
        rows?: Array<{ role: string; text: string; tools?: string[]; reasoning?: string; time?: number }>;
        task?: { title?: string; status?: string; workspacePath?: string; model?: string };
        transcript?: {
          title?: string;
          messageCount?: number;
          model?: string;
          rows?: Array<{ role: string; text: string; tools?: string[]; reasoning?: string; time?: number }>;
        };
        tasks?: Array<{ title?: string; status?: string; workspacePath?: string }>;
        generatedAt?: number;
      }
    | null;
  const description =
    snapshot?.rows?.find((r) => r.role === "user")?.text?.slice(0, 160) ??
    (snapshot?.tasks?.length ? `项目包含 ${snapshot.tasks.length} 个任务` : "ZCode 分享内容");
  const ogTags = `<meta property="og:title" content="${escapeHtml(share.title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:type" content="article" />
<meta name="robots" content="noindex,nofollow" />`;

  let body = "";
  if (snapshot?.type === "transcript" || snapshot?.rows) {
    const meta: string[] = [];
    if (snapshot.messageCount) meta.push(snapshot.messageCount + " 条消息");
    if (snapshot.model) meta.push("模型 " + snapshot.model);
    if (snapshot.directory) meta.push("目录 " + snapshot.directory);
    body = `${meta.length ? `<div class="hint" style="margin-bottom:8px">${escapeHtml(meta.join(" · "))}</div>` : ""}
${renderTranscriptRows(snapshot.rows ?? [])}`;
  } else if (snapshot?.type === "task" && snapshot.task) {
    const task = snapshot.task;
    const transcriptHtml = snapshot.transcript?.rows
      ? `<h2 style="font-size:16px;margin:18px 0 4px">对话记录</h2>${renderTranscriptRows(snapshot.transcript.rows)}`
      : '<div class="hint">该任务没有可展示的对话记录。</div>';
    body = `<div class="hint" style="margin-bottom:8px">状态 ${escapeHtml(task.status ?? "-")}${task.workspacePath ? " · 工作区 " + escapeHtml(task.workspacePath) : ""}${task.model ? " · 模型 " + escapeHtml(task.model) : ""}</div>
${transcriptHtml}`;
  } else if (snapshot?.type === "project") {
    body = `<div class="hint" style="margin-bottom:8px">项目包含 ${snapshot.tasks?.length ?? 0} 个任务</div>
<table style="width:100%;border-collapse:collapse;font-size:13px">
<thead><tr><th style="text-align:left;padding:8px 6px;border-bottom:1px solid #21262d">任务</th><th style="text-align:left;padding:8px 6px;border-bottom:1px solid #21262d">状态</th><th style="text-align:left;padding:8px 6px;border-bottom:1px solid #21262d">工作区</th></tr></thead>
<tbody>${(snapshot.tasks ?? [])
      .map(
        (t) =>
          `<tr><td style="padding:8px 6px;border-bottom:1px solid #21262d">${escapeHtml(t.title ?? "-")}</td><td style="padding:8px 6px;border-bottom:1px solid #21262d">${escapeHtml(t.status ?? "-")}</td><td style="padding:8px 6px;border-bottom:1px solid #21262d;color:#8b949e">${escapeHtml(t.workspacePath ?? "-")}</td></tr>`,
      )
      .join("")}</tbody></table>`;
  } else {
    body = '<div class="hint">快照内容不可用。</div>';
  }

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(share.title)} - ZCode 分享</title>
${ogTags}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
         background: #0d1117; color: #e6edf3; min-height: 100vh; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 32px 18px 60px; }
  .head { border-bottom: 1px solid #21262d; padding-bottom: 14px; margin-bottom: 8px; }
  h1 { font-size: 22px; line-height: 1.4; }
  .meta { color: #8b949e; font-size: 13px; margin-top: 8px; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px;
           background: #1f6feb33; color: #79c0ff; margin-right: 6px; }
  .foot { margin-top: 40px; color: #8b949e; font-size: 12px; text-align: center; }
  .foot a { color: #58a6ff; text-decoration: none; }
</style></head>
<body><div class="wrap">
<div class="head">
  <span class="badge">${typeLabel(share.resourceType)}分享</span><span class="badge">${share.visibility === "open" ? "公开" : "站内"}</span>
  <h1>${escapeHtml(share.title)}</h1>
  <div class="meta">由 ${escapeHtml(share.ownerUsername ?? "用户")} 分享于 ${new Date(Number(share.createdAt)).toLocaleString("zh-CN")} · ${share.viewCount} 次浏览 · 快照时间 ${snapshot?.generatedAt ? new Date(Number(snapshot.generatedAt)).toLocaleString("zh-CN") : "-"}</div>
</div>
${body}
<div class="foot">由 <a href="/">ZCode</a> 生成的工作快照 · 内容为分享时刻的只读版本</div>
</div></body></html>`;
}
