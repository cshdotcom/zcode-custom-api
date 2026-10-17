/**
 * 平台自渲染页面：/login（登录/注册）与 /platform/admin（管理控制台）。
 * 零构建依赖的内联 HTML+JS，避免触碰 ZCode Web 前端（保持原 SPA 完整不动）。
 */

const COMMON_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
         background: #0d1117; color: #e6edf3; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 28px;
          width: min(420px, 92vw); box-shadow: 0 8px 32px rgba(0,0,0,.4); }
  .wide { width: min(960px, 96vw); }
  h1 { font-size: 20px; margin-bottom: 6px; }
  .sub { color: #8b949e; font-size: 13px; margin-bottom: 18px; }
  label { display: block; font-size: 13px; margin: 12px 0 4px; color: #c9d1d9; }
  input, select, textarea { width: 100%; padding: 9px 11px; border-radius: 8px; border: 1px solid #30363d;
         background: #0d1117; color: #e6edf3; font-size: 14px; }
  button { margin-top: 14px; width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #2f81f7;
           background: #1f6feb; color: #fff; font-size: 14px; cursor: pointer; }
  button.ghost { background: transparent; border-color: #30363d; color: #c9d1d9; }
  button.small { width: auto; padding: 5px 10px; font-size: 12px; margin: 0 4px 0 0; }
  .msg { margin-top: 12px; font-size: 13px; min-height: 18px; }
  .err { color: #f85149; } .ok { color: #3fb950; }
  .row { display: flex; gap: 10px; } .row > * { flex: 1; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }
  th, td { padding: 8px 6px; border-bottom: 1px solid #21262d; text-align: left; }
  th { color: #8b949e; font-weight: 500; }
  .tag { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; }
  .tag.admin { background: #1f6feb33; color: #79c0ff; }
  .tag.user { background: #23863633; color: #7ee787; }
  .tag.off { background: #f8514933; color: #ffa198; }
  .tabs { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
  .tabs button { width: auto; margin: 0; padding: 6px 14px; font-size: 13px; }
  section { display: none; } section.active { display: block; }
  code { background: #0d1117; padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #79c0ff; }
  .hint { font-size: 12px; color: #8b949e; margin-top: 6px; line-height: 1.6; }
`;

export function loginPageHtml(needsSetup: boolean, registrationOpen: boolean): string {
  const showRegister = needsSetup || registrationOpen;
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZCode 平台登录</title><style>${COMMON_CSS}</style></head>
<body><div class="card">
<h1>ZCode 平台</h1>
<div class="sub">${needsSetup ? "首次部署：注册的第一个账号将成为管理员" : "请登录以继续使用 ZCode"}</div>
<label>用户名</label><input id="username" autocomplete="username" />
<label>密码</label><input id="password" type="password" autocomplete="current-password" />
<div id="reg2" style="display:none"><label>确认密码</label><input id="password2" type="password" /></div>
<button id="submitBtn">${needsSetup ? "注册管理员账号" : "登录"}</button>
${showRegister ? `<button class="ghost" id="toggleBtn">${needsSetup ? "已有账号？去登录" : "没有账号？去注册"}</button>` : ""}
<div class="msg" id="msg"></div>
</div>
<script>
const needsSetup = ${needsSetup ? "true" : "false"};
let mode = needsSetup ? "register" : "login";
const $ = (id) => document.getElementById(id);
function setMode(next) {
  mode = next;
  $("submitBtn").textContent = mode === "register" ? (needsSetup ? "注册管理员账号" : "注册") : "登录";
  $("reg2").style.display = mode === "register" ? "block" : "none";
  $("toggleBtn").textContent = mode === "register" ? "已有账号？去登录" : "没有账号？去注册";
}
const toggle = $("toggleBtn"); if (toggle) toggle.onclick = () => setMode(mode === "login" ? "register" : "login");
$("submitBtn").onclick = async () => {
  const msg = $("msg"); msg.className = "msg"; msg.textContent = "处理中…";
  try {
    if (mode === "register" && $("password").value !== $("password2").value) throw new Error("两次输入的密码不一致");
    const res = await fetch("/api/platform/auth/" + mode, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: $("username").value, password: $("password").value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    if (data.role === "admin") { location.href = "/platform/admin"; return; }
    location.href = "/";
  } catch (e) { msg.className = "msg err"; msg.textContent = e.message; }
};
document.addEventListener("keydown", (e) => { if (e.key === "Enter") $("submitBtn").click(); });
</script></body></html>`;
}

export function adminPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZCode 平台管理</title><style>${COMMON_CSS}</style></head>
<body><div class="card wide">
<h1>ZCode 平台管理控制台</h1>
<div class="sub" id="whoami"></div>
<div class="tabs">
  <button class="small" data-tab="users">用户管理</button>
  <button class="small" data-tab="search">联网搜索</button>
  <button class="small" data-tab="browser">浏览器桥</button>
  <button class="small" data-tab="account">账号安全</button>
  <button class="small ghost" id="logoutBtn">退出登录</button>
</div>

<section id="tab-users" class="active">
  <table><thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>创建时间</th><th>最近登录</th><th>操作</th></tr></thead>
  <tbody id="userRows"></tbody></table>
  <div class="hint">新用户：</div>
  <div class="row"><input id="nu-name" placeholder="用户名" /><input id="nu-pass" placeholder="初始密码(≥6位)" /></div>
  <div class="row"><select id="nu-role"><option value="user">普通用户</option><option value="admin">管理员</option></select>
  <button class="small" id="nu-create">创建用户</button></div>
  <div class="msg" id="usersMsg"></div>
</section>

<section id="tab-search">
  <div class="row">
    <div><label>激活 Provider</label><select id="s-provider"></select></div>
    <div><label>返回条数</label><input id="s-count" type="number" min="1" max="20" /></div>
  </div>
  <div class="row">
    <div><label>API Key（部分 Provider 可空）</label><input id="s-key" placeholder="sk-..." /></div>
    <div><label>Base URL / CX（SearXNG、Google PSE、custom）</label><input id="s-base" placeholder="http://searxng:8080/search" /></div>
  </div>
  <div class="row">
    <div><label>智谱引擎标识（仅 zhipu）</label><input id="s-engine" placeholder="search_std / search_pro" /></div>
    <div><label>对外端点 Bearer Token（可空=不校验）</label><input id="s-token" placeholder="为 OpenWebUI 接入设置密钥" /></div>
  </div>
  <button class="small" id="s-save">保存配置</button>
  <button class="small ghost" id="s-test">测试搜索</button>
  <div class="hint" id="s-desc"></div>
  <div class="hint">对外兼容端点（供 OpenWebUI 接入）：<br>
    · 外部搜索(external)：POST <code>/search</code>，body <code>{"query":"...","count":5}</code> → <code>[{"link","title","snippet"}]</code><br>
    · SearXNG 引擎：GET <code>/search?q=&lt;query&gt;&amp;format=json</code> → <code>{"query","results"}</code><br>
    · Agent 侧 MCP 工具：<code>platform-web-search / web_search</code></div>
  <div class="msg" id="searchMsg"></div>
</section>

<section id="tab-browser">
  <div id="browserInfo" class="hint">加载中…</div>
  <div class="hint">配置方式（环境变量）：<br>
    · <code>ZCODE_BROWSER_REMOTE_ENDPOINT</code>：远程浏览器 WebSocket 地址（如 <code>ws://playwright:9222/</code>）<br>
    · <code>ZCODE_BROWSER_REMOTE_MODE</code>：<code>playwright</code>（Playwright run-server）或 <code>cdp</code>（任意 CDP 端点 / browserless）<br>
    配置后 Agent 即拥有：网页访问、元素点击、输入、截图、DOM 元素坐标拾取等全部浏览器操控能力。</div>
  <div class="msg" id="browserMsg"></div>
</section>

<section id="tab-account">
  <label>当前密码</label><input id="cp-old" type="password" />
  <label>新密码（≥6位）</label><input id="cp-new" type="password" />
  <button class="small" id="cp-save">修改密码</button>
  <div class="msg" id="accountMsg"></div>
</section>
</div>
<script>
const $ = (id) => document.getElementById(id);
const msg = (id, text, ok) => { const el = $(id); el.className = "msg " + (ok ? "ok" : "err"); el.textContent = text; };
document.querySelectorAll(".tabs button[data-tab]").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll("section").forEach((s) => s.classList.remove("active"));
    document.querySelectorAll(".tabs button[data-tab]").forEach((b) => b.classList.remove("ghost"));
    $("tab-" + btn.dataset.tab).classList.add("active");
    btn.classList.add("ghost");
  };
});
async function api(path, options) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}
const fmt = (n) => n ? new Date(Number(n)).toLocaleString("zh-CN") : "-";
async function loadMe() {
  try {
    const me = await api("/api/platform/auth/me");
    $("whoami").textContent = "当前用户：" + me.username + (me.role === "admin" ? "（管理员）" : "");
    if (me.role !== "admin") document.querySelectorAll(".tabs button[data-tab]").forEach((b) => { if (b.dataset.tab !== "account") b.style.display = "none"; });
  } catch (e) { location.href = "/login"; }
}
async function loadUsers() {
  try {
    const data = await api("/api/platform/admin/users");
    $("userRows").innerHTML = data.users.map((u) =>
      "<tr><td>" + u.username + "</td><td><span class='tag " + u.role + "'>" + u.role + "</span></td>" +
      "<td>" + (u.status === "active" ? "正常" : "<span class='tag off'>禁用</span>") + "</td>" +
      "<td>" + fmt(u.createdAt) + "</td><td>" + fmt(u.lastLoginAt) + "</td>" +
      "<td><button class='small ghost' onclick=\\"userOp('" + u.id + "','" + (u.status === "active" ? "disable" : "enable") + "')\\">" + (u.status === "active" ? "禁用" : "启用") + "</button>" +
      "<button class='small ghost' onclick=\\"userOp('" + u.id + "','reset')\\">重置密码</button>" +
      "<button class='small ghost' onclick=\\"userOp('" + u.id + "','delete')\\">删除</button></td></tr>").join("");
  } catch (e) { msg("usersMsg", e.message); }
}
async function userOp(id, op) {
  try {
    if (op === "reset") {
      const pass = prompt("输入新密码（≥6位）"); if (!pass) return;
      await api("/api/platform/admin/users/" + id, { method: "PATCH", body: JSON.stringify({ action: "resetPassword", password: pass }) });
    } else if (op === "delete") {
      if (!confirm("确认删除该用户？")) return;
      await api("/api/platform/admin/users/" + id, { method: "DELETE" });
    } else {
      await api("/api/platform/admin/users/" + id, { method: "PATCH", body: JSON.stringify({ action: op === "disable" ? "disable" : "enable" }) });
    }
    await loadUsers(); msg("usersMsg", "操作成功", true);
  } catch (e) { msg("usersMsg", e.message); }
}
$("nu-create").onclick = async () => {
  try {
    await api("/api/platform/admin/users", { method: "POST", body: JSON.stringify({ username: $("nu-name").value, password: $("nu-pass").value, role: $("nu-role").value }) });
    $("nu-name").value = ""; $("nu-pass").value = ""; await loadUsers(); msg("usersMsg", "创建成功", true);
  } catch (e) { msg("usersMsg", e.message); }
};
let providerMeta = [];
async function loadSearch() {
  try {
    const meta = await api("/api/platform/search/providers");
    providerMeta = meta.providers;
    $("s-provider").innerHTML = providerMeta.map((p) => "<option value='" + p.id + "'>" + p.name + "</option>").join("");
    const cfg = await api("/api/platform/search/config");
    $("s-provider").value = cfg.provider; $("s-count").value = cfg.count;
    $("s-key").value = cfg.apiKey || ""; $("s-base").value = cfg.baseUrl || "";
    $("s-engine").value = cfg.engine || ""; $("s-token").value = cfg.apiToken || "";
    syncDesc();
  } catch (e) { msg("searchMsg", e.message); }
}
function syncDesc() {
  const p = providerMeta.find((x) => x.id === $("s-provider").value);
  $("s-desc").textContent = p ? ("说明：" + p.description + (p.requiresApiKey ? "（必填 API Key）" : "") + (p.requiresBaseUrl ? "（必填 Base URL/CX）" : "")) : "";
}
$("s-provider").onchange = syncDesc;
$("s-save").onclick = async () => {
  try {
    await api("/api/platform/search/config", { method: "PUT", body: JSON.stringify({
      provider: $("s-provider").value, count: Number($("s-count").value) || 8,
      apiKey: $("s-key").value, baseUrl: $("s-base").value, engine: $("s-engine").value, apiToken: $("s-token").value }) });
    msg("searchMsg", "配置已保存并即时生效", true);
  } catch (e) { msg("searchMsg", e.message); }
};
$("s-test").onclick = async () => {
  try {
    const q = prompt("输入测试搜索词", "OpenAI 最新新闻"); if (!q) return;
    const data = await api("/api/platform/search?q=" + encodeURIComponent(q));
    msg("searchMsg", "成功返回 " + data.results.length + " 条结果（provider=" + (data.results[0]?.provider || "-") + "）", true);
  } catch (e) { msg("searchMsg", "搜索失败：" + e.message); }
};
async function loadBrowser() {
  try {
    const data = await api("/api/platform/browser/status");
    $("browserInfo").innerHTML = data.enabled
      ? "状态：<b style='color:#3fb950'>已启用</b><br>endpoint：<code>" + data.endpoint + "</code><br>mode：<code>" + data.mode + "</code><br>连通性：" +
        (data.available ? "<span style='color:#3fb950'>正常</span>" : "<span style='color:#f85149'>不可用</span>") +
        (data.lastError ? ("<br>最近错误：" + data.lastError) : "") +
        (data.descriptor ? ("<br>backend：" + data.descriptor.name + " (" + data.descriptor.id + ")") : "")
      : "未启用：未设置 ZCODE_BROWSER_REMOTE_ENDPOINT 环境变量，浏览器自动化能力关闭。";
  } catch (e) { $("browserInfo").textContent = "读取失败：" + e.message; }
}
$("cp-save").onclick = async () => {
  try {
    await api("/api/platform/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: $("cp-old").value, newPassword: $("cp-new").value }) });
    msg("accountMsg", "密码已修改", true);
  } catch (e) { msg("accountMsg", e.message); }
};
$("logoutBtn").onclick = async () => { await fetch("/api/platform/auth/logout", { method: "POST" }); location.href = "/login"; };
loadMe().then(() => { loadUsers(); loadSearch(); loadBrowser(); });
</script></body></html>`;
}
