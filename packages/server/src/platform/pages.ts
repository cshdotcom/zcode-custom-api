/**
 * 平台自渲染页面：/login（登录/注册）、/platform/admin（管理控制台）、
 * /platform/shares（分享中心）、/s/:token（公开分享页）。
 * 零构建依赖的内联 HTML+JS，避免触碰 ZCode Web 前端（保持原 SPA 完整不动）。
 */

const COMMON_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
         background: #0d1117; color: #e6edf3; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 28px;
          width: min(420px, 92vw); box-shadow: 0 8px 32px rgba(0,0,0,.4); }
  .wide { width: min(1080px, 96vw); }
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
  .tag.pending { background: #d2992233; color: #e3b341; }
  .tag.off { background: #f8514933; color: #ffa198; }
  .tag.open { background: #23863633; color: #7ee787; }
  .tag.pub { background: #1f6feb33; color: #79c0ff; }
  .tabs { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
  .tabs button { width: auto; margin: 0; padding: 6px 14px; font-size: 13px; }
  section { display: none; } section.active { display: block; }
  code { background: #0d1117; padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #79c0ff; }
  .hint { font-size: 12px; color: #8b949e; margin-top: 6px; line-height: 1.6; }
  a { color: #58a6ff; text-decoration: none; }
`;

export function loginPageHtml(
  needsSetup: boolean,
  config: { enableSignup: boolean; requireInvite: boolean; loginNotice?: string; pendingNotice: string },
  pending = false,
): string {
  const showRegister = needsSetup || config.enableSignup;
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZCode 平台登录</title><style>${COMMON_CSS}</style></head>
<body><div class="card">
<h1>ZCode 平台</h1>
<div class="sub">${needsSetup ? "首次部署：注册的第一个账号将成为管理员" : "请登录以继续使用 ZCode"}</div>
${
  config.loginNotice
    ? `<div class="hint" style="border:1px solid #30363d;border-radius:8px;padding:8px 10px;margin-bottom:8px">${config.loginNotice}</div>`
    : ""
}
${
  pending
    ? `<div class="msg err" style="border:1px solid #f8514955;border-radius:8px;padding:10px">${config.pendingNotice}</div>`
    : ""
}
<label>用户名</label><input id="username" autocomplete="username" />
<label>密码</label><input id="password" type="password" autocomplete="current-password" />
<div id="reg2" style="display:none"><label>确认密码</label><input id="password2" type="password" /></div>
<div id="inviteWrap" style="display:none"><label>邀请码${config.requireInvite ? "（必填）" : "（选填）"}</label><input id="inviteCode" placeholder="向管理员获取邀请码" autocomplete="off" /><div class="hint" id="inviteHint"></div></div>
<button id="submitBtn">${needsSetup ? "注册管理员账号" : "登录"}</button>
${showRegister ? `<button class="ghost" id="toggleBtn">${needsSetup ? "已有账号？去登录" : "没有账号？去注册"}</button>` : ""}
<div class="msg" id="msg"></div>
<div class="hint">忘记密码？请联系站点管理员在管理控制台为你重置。</div>
</div>
<script>
const needsSetup = ${needsSetup ? "true" : "false"};
const requireInvite = ${config.requireInvite ? "true" : "false"};
let mode = needsSetup ? "register" : "login";
const $ = (id) => document.getElementById(id);
function setMode(next) {
  mode = next;
  $("submitBtn").textContent = mode === "register" ? (needsSetup ? "注册管理员账号" : "注册") : "登录";
  $("reg2").style.display = mode === "register" ? "block" : "none";
  $("inviteWrap").style.display = mode === "register" && !needsSetup ? "block" : "none";
  if (toggle) toggle.textContent = mode === "register" ? "已有账号？去登录" : "没有账号？去注册";
}
const toggle = $("toggleBtn"); if (toggle) toggle.onclick = () => setMode(mode === "login" ? "register" : "login");
setMode(mode);
let inviteTimer = null;
$("inviteCode").addEventListener("input", () => {
  clearTimeout(inviteTimer);
  const code = $("inviteCode").value.trim();
  if (!code) { $("inviteHint").textContent = ""; return; }
  inviteTimer = setTimeout(async () => {
    try {
      const res = await fetch("/api/platform/auth/invite/" + encodeURIComponent(code));
      const data = await res.json();
      $("inviteHint").textContent = data.valid ? "✓ 邀请码有效" + (data.note ? "（" + data.note + "）" : "") : "✗ " + (data.reason || "无效");
      $("inviteHint").style.color = data.valid ? "#3fb950" : "#f85149";
    } catch (e) { $("inviteHint").textContent = ""; }
  }, 300);
});
$("submitBtn").onclick = async () => {
  const msg = $("msg"); msg.className = "msg"; msg.textContent = "处理中…";
  try {
    if (mode === "register" && $("password").value !== $("password2").value) throw new Error("两次输入的密码不一致");
    const payload = { username: $("username").value, password: $("password").value };
    if (mode === "register" && $("inviteCode") && $("inviteCode").value.trim()) payload.inviteCode = $("inviteCode").value.trim();
    const res = await fetch("/api/platform/auth/" + mode, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    if (data.role === "pending") { location.href = "/login?pending=1"; return; }
    if (data.role === "admin") { location.href = "/platform/admin"; return; }
    const target = new URLSearchParams(location.search).get("next");
    location.href = target && target.startsWith("/") ? target : "/";
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
  <button class="small" data-tab="groups">用户组</button>
  <button class="small" data-tab="invites">邀请码</button>
  <button class="small" data-tab="shares">分享管理</button>
  <button class="small" data-tab="settings">系统设置</button>
  <button class="small" data-tab="search">联网搜索</button>
  <button class="small" data-tab="browser">浏览器桥</button>
  <button class="small" data-tab="account">账号安全</button>
  <button class="small ghost" id="logoutBtn">退出登录</button>
</div>

<section id="tab-users" class="active">
  <table><thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>用户组</th><th>创建时间</th><th>最近登录</th><th>操作</th></tr></thead>
  <tbody id="userRows"></tbody></table>
  <div class="hint">新用户：</div>
  <div class="row"><input id="nu-name" placeholder="用户名" /><input id="nu-pass" placeholder="初始密码(≥6位)" />
  <select id="nu-role"><option value="user">普通用户</option><option value="admin">管理员</option><option value="pending">待审批</option></select>
  <button class="small" id="nu-create">创建用户</button></div>
  <div class="msg" id="usersMsg"></div>
</section>

<section id="tab-groups">
  <table><thead><tr><th>组名</th><th>成员数</th><th>权限</th><th>创建时间</th><th>操作</th></tr></thead>
  <tbody id="groupRows"></tbody></table>
  <div class="hint">新建组：</div>
  <div class="row"><input id="ng-name" placeholder="组名" /><input id="ng-desc" placeholder="描述（可选）" />
  <button class="small" id="ng-create">创建组</button></div>
  <div class="msg" id="groupsMsg"></div>
  <div id="groupEditor" style="display:none;margin-top:14px;border:1px solid #30363d;border-radius:8px;padding:12px">
    <div class="sub" id="ge-title"></div>
    <label>权限开关（OpenWebUI 点分键，勾选 = 该组成员放行）</label>
    <div id="ge-perms" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px;font-size:13px"></div>
    <label>成员</label>
    <div id="ge-members" style="font-size:13px;color:#8b949e"></div>
    <div class="row" style="margin-top:8px">
      <select id="ge-add-user"></select><button class="small" id="ge-add-btn">添加成员</button>
    </div>
    <button class="small" id="ge-save">保存权限</button>
    <button class="small ghost" id="ge-close">关闭</button>
  </div>
</section>

<section id="tab-invites">
  <div class="hint">邀请码控制注册准入：开启「需要邀请码」后，新用户注册必须携带有效邀请码（系统设置 Tab）。创建邀请码可设置次数上限 / 有效期 / 注册后的默认角色。</div>
  <div class="row" style="margin-top:10px">
    <div><label>次数上限（0=不限）</label><input id="ni-max" type="number" min="0" value="1" /></div>
    <div><label>有效期（天，0=永久）</label><input id="ni-days" type="number" min="0" value="7" /></div>
    <div><label>注册后角色</label><select id="ni-role"><option value="user">普通用户</option><option value="pending">待审批</option></select></div>
    <div><label>备注</label><input id="ni-note" placeholder="如：内测用户" /></div>
  </div>
  <button class="small" id="ni-create">生成邀请码</button>
  <table><thead><tr><th>邀请码</th><th>已用/上限</th><th>注册角色</th><th>有效期至</th><th>备注</th><th>状态</th><th>操作</th></tr></thead>
  <tbody id="inviteRows"></tbody></table>
  <div class="msg" id="invitesMsg"></div>
</section>

<section id="tab-shares">
  <div class="hint">全站分享（含其他用户创建的）。分享中心（创建/管理自己的分享）：<a href="/platform/shares" target="_blank">/platform/shares</a></div>
  <table><thead><tr><th>标题</th><th>类型</th><th>可见性</th><th>属主</th><th>浏览量</th><th>创建时间</th><th>链接</th><th>操作</th></tr></thead>
  <tbody id="shareRows"></tbody></table>
  <div class="msg" id="sharesMsg"></div>
</section>

<section id="tab-settings">
  <div class="row">
    <div><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="st-signup" style="width:auto" /> 开放注册</label></div>
    <div><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="st-invite" style="width:auto" /> 注册需要邀请码</label></div>
    <div><label>新注册用户默认角色</label><select id="st-role"><option value="user">普通用户（直接可用）</option><option value="pending">待审批（需管理员放行）</option></select></div>
  </div>
  <label>登录页公告（可空）</label><textarea id="st-notice" rows="2" placeholder="显示在登录页顶部，如维护公告、入站指引"></textarea>
  <label>待审批提示语</label><textarea id="st-pending" rows="2"></textarea>
  <button class="small" id="st-save">保存设置</button>
  <div class="hint">配置持久化在 users.db 的 config 表（OpenWebUI env 默认 + DB 覆盖同款模式），保存即时生效、无需重启。</div>
  <div class="msg" id="settingsMsg"></div>
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
const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
async function loadMe() {
  try {
    const me = await api("/api/platform/auth/me");
    $("whoami").textContent = "当前用户：" + me.username + (me.role === "admin" ? "（管理员）" : "");
    if (me.role !== "admin") document.querySelectorAll(".tabs button[data-tab]").forEach((b) => { if (b.dataset.tab !== "account") b.style.display = "none"; });
  } catch (e) { location.href = "/login"; }
}
// ---------- 用户 ----------
let allUsers = [];
async function loadUsers() {
  try {
    const data = await api("/api/platform/admin/users");
    allUsers = data.users;
    $("userRows").innerHTML = data.users.map((u) =>
      "<tr><td>" + esc(u.username) + "</td><td><span class='tag " + u.role + "'>" + (u.role === "pending" ? "待审批" : u.role) + "</span></td>" +
      "<td>" + (u.status === "active" ? "正常" : "<span class='tag off'>禁用</span>") + "</td>" +
      "<td>" + esc((u.groupNames || []).join(", ")) + "</td>" +
      "<td>" + fmt(u.createdAt) + "</td><td>" + fmt(u.lastLoginAt) + "</td>" +
      "<td>" +
      (u.role === "pending" ? "<button class='small ghost' onclick=\\"userOp('" + u.id + "','approve')\\">通过审批</button>" : "") +
      "<button class='small ghost' onclick=\\"userOp('" + u.id + "','" + (u.status === "active" ? "disable" : "enable") + "')\\">" + (u.status === "active" ? "禁用" : "启用") + "</button>" +
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
      await api("/api/platform/admin/users/" + id, { method: "PATCH", body: JSON.stringify({ action: op }) });
    }
    await Promise.all([loadUsers(), loadGroups()]);
    msg("usersMsg", "操作成功", true);
  } catch (e) { msg("usersMsg", e.message); }
}
$("nu-create").onclick = async () => {
  try {
    await api("/api/platform/admin/users", { method: "POST", body: JSON.stringify({ username: $("nu-name").value, password: $("nu-pass").value, role: $("nu-role").value }) });
    $("nu-name").value = ""; $("nu-pass").value = ""; await loadUsers(); msg("usersMsg", "创建成功", true);
  } catch (e) { msg("usersMsg", e.message); }
};
// ---------- 用户组 ----------
const PERM_KEYS = [
  ["chat.share", "分享对话/任务/项目"],
  ["chat.export", "导出内容"],
  ["sharing.public", "免登录公开分享"],
  ["workspace.prompts", "使用提示词工作区"],
  ["features.web_search", "联网搜索"],
];
let groups = [];
async function loadGroups() {
  try {
    const data = await api("/api/platform/groups");
    groups = data.groups;
    $("groupRows").innerHTML = groups.map((g) => {
      const permSummary = PERM_KEYS.filter(([k]) => g.permissions[k] === true).map(([, label]) => label).join("、") || "（默认权限）";
      return "<tr><td>" + esc(g.name) + "</td><td>" + (g.memberCount || 0) + "</td><td style='font-size:12px;color:#8b949e'>" + esc(permSummary) + "</td>" +
      "<td>" + fmt(g.createdAt) + "</td>" +
      "<td><button class='small ghost' onclick=\\"editGroup('" + g.id + "')\\">编辑</button>" +
      "<button class='small ghost' onclick=\\"deleteGroup('" + g.id + "')\\">删除</button></td></tr>";
    }).join("") || "<tr><td colspan='5' class='hint'>暂无用户组</td></tr>";
    await loadGroupEditorUsers();
  } catch (e) { msg("groupsMsg", e.message); }
}
$("ng-create").onclick = async () => {
  try {
    await api("/api/platform/admin/groups", { method: "POST", body: JSON.stringify({ name: $("ng-name").value, description: $("ng-desc").value }) });
    $("ng-name").value = ""; $("ng-desc").value = ""; await loadGroups(); msg("groupsMsg", "创建成功", true);
  } catch (e) { msg("groupsMsg", e.message); }
};
async function deleteGroup(id) {
  if (!confirm("确认删除该组？")) return;
  try { await api("/api/platform/admin/groups/" + id, { method: "DELETE" }); await loadGroups(); msg("groupsMsg", "已删除", true); }
  catch (e) { msg("groupsMsg", e.message); }
}
let editorGroupId = null;
async function editGroup(id) {
  const g = groups.find((x) => x.id === id); if (!g) return;
  editorGroupId = id;
  $("groupEditor").style.display = "block";
  $("ge-title").textContent = "编辑组：" + g.name;
  $("ge-perms").innerHTML = PERM_KEYS.map(([k, label]) => {
    const checked = g.permissions[k] === true ? " checked" : "";
    return "<label style='display:flex;align-items:center;gap:6px;margin:2px 0'><input type='checkbox' data-perm='" + k + "' style='width:auto'" + checked + " /> " + label + " <code style='font-size:10px'>" + k + "</code></label>";
  }).join("");
  const memberNames = (g.memberIds || []).map((uid) => { const u = allUsers.find((x) => x.id === uid); return u ? u.username : uid; });
  $("ge-members").textContent = memberNames.length ? memberNames.join(", ") : "（暂无成员）";
}
async function loadGroupEditorUsers() {
  try {
    const sel = $("ge-add-user");
    sel.innerHTML = allUsers.map((u) => "<option value='" + u.id + "'>" + esc(u.username) + "</option>").join("");
  } catch (e) {}
}
$("ge-add-btn").onclick = async () => {
  if (!editorGroupId) return;
  try {
    await api("/api/platform/admin/groups/" + editorGroupId, { method: "PATCH", body: JSON.stringify({ memberIds: [...(groups.find((x) => x.id === editorGroupId).memberIds || []), $("ge-add-user").value] }) });
    await loadGroups(); editGroup(editorGroupId); msg("groupsMsg", "成员已添加", true);
  } catch (e) { msg("groupsMsg", e.message); }
};
$("ge-save").onclick = async () => {
  if (!editorGroupId) return;
  const permissions = {};
  document.querySelectorAll("#ge-perms input[data-perm]").forEach((cb) => { permissions[cb.dataset.perm] = cb.checked; });
  try {
    await api("/api/platform/admin/groups/" + editorGroupId, { method: "PATCH", body: JSON.stringify({ permissions }) });
    await loadGroups(); msg("groupsMsg", "权限已保存", true);
  } catch (e) { msg("groupsMsg", e.message); }
};
$("ge-close").onclick = () => { $("groupEditor").style.display = "none"; editorGroupId = null; };
// ---------- 邀请码 ----------
async function loadInvites() {
  try {
    const data = await api("/api/platform/admin/invites");
    $("inviteRows").innerHTML = data.invites.map((i) => {
      const expired = i.expiresAt && i.expiresAt <= Date.now();
      const exhausted = i.maxUses > 0 && i.usedCount >= i.maxUses;
      const state = i.disabled ? "<span class='tag off'>停用</span>" : expired ? "<span class='tag off'>过期</span>" : exhausted ? "<span class='tag off'>用尽</span>" : "<span class='tag user'>可用</span>";
      return "<tr><td><code>" + esc(i.code) + "</code> <button class='small ghost' onclick=\\"copyText('" + esc(i.code) + "')\\">复制</button></td>" +
      "<td>" + i.usedCount + "/" + (i.maxUses || "∞") + "</td>" +
      "<td>" + (i.defaultRole === "pending" ? "待审批" : "普通用户") + "</td>" +
      "<td>" + (i.expiresAt ? fmt(i.expiresAt) : "永久") + "</td>" +
      "<td>" + esc(i.note || "-") + "</td><td>" + state + "</td>" +
      "<td><button class='small ghost' onclick=\\"toggleInvite('" + i.code + "'," + (!i.disabled) + ")\\">" + (i.disabled ? "启用" : "停用") + "</button>" +
      "<button class='small ghost' onclick=\\"deleteInvite('" + i.code + "')\\">删除</button></td></tr>";
    }).join("") || "<tr><td colspan='7' class='hint'>暂无邀请码</td></tr>";
  } catch (e) { msg("invitesMsg", e.message); }
}
$("ni-create").onclick = async () => {
  try {
    const data = await api("/api/platform/admin/invites", { method: "POST", body: JSON.stringify({ maxUses: Number($("ni-max").value) || 0, expiresInDays: Number($("ni-days").value) || 0, defaultRole: $("ni-role").value, note: $("ni-note").value }) });
    $("ni-note").value = ""; await loadInvites(); msg("invitesMsg", "邀请码已生成：" + data.invite.code, true);
  } catch (e) { msg("invitesMsg", e.message); }
};
async function toggleInvite(code, disabled) {
  try { await api("/api/platform/admin/invites/" + code, { method: "DELETE" }); await loadInvites(); } catch (e) { msg("invitesMsg", e.message); }
}
async function deleteInvite(code) {
  if (!confirm("确认删除邀请码 " + code + "？")) return;
  try { await api("/api/platform/admin/invites/" + code, { method: "DELETE" }); await loadInvites(); } catch (e) { msg("invitesMsg", e.message); }
}
// ---------- 分享 ----------
async function loadShares() {
  try {
    const data = await api("/api/platform/shares");
    $("shareRows").innerHTML = data.shares.map((s) =>
      "<tr><td style='max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" + esc(s.title) + "</td>" +
      "<td>" + ({ session: "对话", task: "任务", project: "项目" }[s.resourceType] || s.resourceType) + "</td>" +
      "<td><span class='tag " + (s.visibility === "open" ? "open" : "pub") + "'>" + (s.visibility === "open" ? "公开(免登录)" : "站内(需登录)") + "</span></td>" +
      "<td>" + esc(s.ownerUsername || s.ownerId) + "</td><td>" + s.viewCount + "</td><td>" + fmt(s.createdAt) + "</td>" +
      "<td><a href='/s/" + s.token + "' target='_blank'>/s/" + s.token + "</a> <button class='small ghost' onclick=\\"copyText(location.origin+'/s/" + s.token + "')\\">复制</button></td>" +
      "<td><button class='small ghost' onclick=\\"deleteShare('" + s.token + "')\\">删除</button></td></tr>").join("") || "<tr><td colspan='8' class='hint'>暂无分享</td></tr>";
  } catch (e) { msg("sharesMsg", e.message); }
}
async function deleteShare(token) {
  if (!confirm("确认删除该分享？公开链接将立即失效。")) return;
  try { await api("/api/platform/shares/" + token, { method: "DELETE" }); await loadShares(); } catch (e) { msg("sharesMsg", e.message); }
}
// ---------- 系统设置 ----------
async function loadSettings() {
  try {
    const cfg = await api("/api/platform/admin/config");
    $("st-signup").checked = cfg.enableSignup; $("st-invite").checked = cfg.requireInvite;
    $("st-role").value = cfg.defaultRole; $("st-notice").value = cfg.loginNotice || "";
    $("st-pending").value = cfg.pendingNotice || "";
  } catch (e) { msg("settingsMsg", e.message); }
}
$("st-save").onclick = async () => {
  try {
    await api("/api/platform/admin/config", { method: "PUT", body: JSON.stringify({
      enableSignup: $("st-signup").checked, requireInvite: $("st-invite").checked,
      defaultRole: $("st-role").value, loginNotice: $("st-notice").value, pendingNotice: $("st-pending").value }) });
    msg("settingsMsg", "设置已保存并即时生效", true);
  } catch (e) { msg("settingsMsg", e.message); }
};
// ---------- 联网搜索 ----------
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
// ---------- 浏览器桥 ----------
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
// ---------- 账号 ----------
$("cp-save").onclick = async () => {
  try {
    await api("/api/platform/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: $("cp-old").value, newPassword: $("cp-new").value }) });
    msg("accountMsg", "密码已修改", true);
  } catch (e) { msg("accountMsg", e.message); }
};
$("logoutBtn").onclick = async () => { await fetch("/api/platform/auth/logout", { method: "POST" }); location.href = "/login"; };
function copyText(text) { navigator.clipboard.writeText(text).then(() => alert("已复制：" + text)).catch(() => prompt("手动复制：", text)); }
loadMe().then(() => { loadUsers(); loadGroups(); loadInvites(); loadShares(); loadSettings(); loadSearch(); loadBrowser(); });
</script></body></html>`;
}

// ================= 分享中心（/platform/shares） =================

export function shareCenterPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>分享中心 - ZCode</title><style>${COMMON_CSS}
  .pill { border:1px solid #30363d; border-radius:8px; padding:2px 8px; font-size:11px; color:#8b949e; }
</style></head>
<body><div class="card wide">
<h1>分享中心</h1>
<div class="sub">把 <b>对话 / 任务 / 项目</b> 生成快照分享链接（快照 = 分享时刻的内容，后续编辑不影响已分享版本）· <a href="/">返回工作台</a> · <a href="/platform/admin">管理控制台</a></div>

<div class="row" style="align-items:flex-end">
  <div><label>类型</label><select id="r-type">
    <option value="session">对话</option><option value="task">任务</option><option value="project">项目</option>
  </select></div>
  <div style="flex:2"><label>选择资源</label><select id="r-resource"></select></div>
  <div><label>可见性</label><select id="r-vis">
    <option value="public">站内（需登录本站）</option><option value="open">公开（任何有链接的人）</option>
  </select></div>
  <div style="flex:0"><button class="small" id="r-create" style="margin-top:12px">创建分享</button></div>
</div>
<div class="hint">快照包含对话消息文本与工具调用摘要；不含文件工作区与终端内容。创建后链接立即生效。</div>
<div class="msg" id="createMsg"></div>

<table><thead><tr><th>标题</th><th>类型</th><th>可见性</th><th>浏览量</th><th>创建时间</th><th>链接</th><th>操作</th></tr></thead>
<tbody id="shareRows"></tbody></table>
<div class="msg" id="listMsg"></div>
</div>
<script>
const $ = (id) => document.getElementById(id);
const msg = (id, text, ok) => { const el = $(id); el.className = "msg " + (ok ? "ok" : "err"); el.textContent = text; };
const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const fmt = (n) => n ? new Date(Number(n)).toLocaleString("zh-CN") : "-";
const TYPE_LABEL = { session: "对话", task: "任务", project: "项目" };
async function api(path, options) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}
let resources = { sessions: [], tasks: [], projects: [] };
async function loadResources() {
  try {
    resources = await api("/api/platform/resources");
    fillResourceOptions();
  } catch (e) { msg("createMsg", "加载资源失败：" + e.message); }
}
function fillResourceOptions() {
  const type = $("r-type").value;
  const list = type === "session" ? resources.sessions : type === "task" ? resources.tasks : resources.projects;
  $("r-resource").innerHTML = list.length === 0
    ? "<option value=''>（暂无可分享的" + TYPE_LABEL[type] + "）</option>"
    : list.map((item) => {
        const id = item.id || item.taskId || item.groupId;
        const label = (item.title || "(未命名)") + (item.messageCount !== undefined ? "（" + item.messageCount + " 条消息）" : item.status ? "（" + item.status + "）" : "");
        return "<option value='" + esc(id) + "'>" + esc(label) + "</option>";
      }).join("");
}
$("r-type").onchange = fillResourceOptions;
$("r-create").onclick = async () => {
  const resourceId = $("r-resource").value;
  if (!resourceId) { msg("createMsg", "请先选择要分享的资源"); return; }
  try {
    const data = await api("/api/platform/shares", { method: "POST", body: JSON.stringify({
      resourceType: $("r-type").value, resourceId, visibility: $("r-vis").value }) });
    const url = location.origin + data.url;
    msg("createMsg", "分享已创建：" + url, true);
    navigator.clipboard && navigator.clipboard.writeText(url).catch(() => {});
    await loadShares();
  } catch (e) { msg("createMsg", e.message); }
};
async function loadShares() {
  try {
    const data = await api("/api/platform/shares");
    $("shareRows").innerHTML = data.shares.map((s) =>
      "<tr><td style='max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" + esc(s.title) + "</td>" +
      "<td>" + TYPE_LABEL[s.resourceType] + "</td>" +
      "<td><span class='tag " + (s.visibility === "open" ? "open" : "pub") + "'>" + (s.visibility === "open" ? "公开" : "站内") + "</span></td>" +
      "<td>" + s.viewCount + "</td><td>" + fmt(s.createdAt) + "</td>" +
      "<td><a href='/s/" + s.token + "' target='_blank'>/s/" + s.token + "</a></td>" +
      "<td><button class='small ghost' onclick=\\"copyLink('" + s.token + "')\\">复制</button>" +
      "<button class='small ghost' onclick=\\"refreshShare('" + s.token + "')\\">更新快照</button>" +
      "<button class='small ghost' onclick=\\"toggleVis('" + s.token + "','" + s.visibility + "')\\">" + (s.visibility === "open" ? "改为站内" : "改为公开") + "</button>" +
      "<button class='small ghost' onclick=\\"deleteShare('" + s.token + "')\\">删除</button></td></tr>").join("") || "<tr><td colspan='7' class='hint'>还没有任何分享</td></tr>";
  } catch (e) { msg("listMsg", e.message); }
}
function copyLink(token) {
  const url = location.origin + "/s/" + token;
  navigator.clipboard && navigator.clipboard.writeText(url).then(() => alert("已复制：" + url)).catch(() => prompt("手动复制：", url));
}
async function refreshShare(token) {
  try { await api("/api/platform/shares/" + token, { method: "PATCH", body: JSON.stringify({ refresh: true }) }); msg("listMsg", "快照已更新为当前内容", true); }
  catch (e) { msg("listMsg", e.message); }
}
async function toggleVis(token, current) {
  try { await api("/api/platform/shares/" + token, { method: "PATCH", body: JSON.stringify({ visibility: current === "open" ? "public" : "open" }) }); await loadShares(); }
  catch (e) { msg("listMsg", e.message); }
}
async function deleteShare(token) {
  if (!confirm("确认删除该分享？公开链接将立即失效。")) return;
  try { await api("/api/platform/shares/" + token, { method: "DELETE" }); await loadShares(); }
  catch (e) { msg("listMsg", e.message); }
}
loadResources().then(loadShares);
</script></body></html>`;
}

// ================= 公开分享页（/s/:token，SSR + og: meta） =================

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
