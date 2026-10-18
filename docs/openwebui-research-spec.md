# OpenWebUI v0.12.3 源码研究 → ZCode 复刻规格（2026-10-18）

> 研究来源：/home/z/my-project/research/open-webui（open-webui/open-webui dev 分支 91ea4e3）
> 本文档是 ZCode standalone-deep-integration 分支功能复刻的权威依据。

## 一、知识库（Knowledge / RAG）

UI：`routes/(app)/workspace/knowledge/+page.svelte`（列表）、`[id]/+page.svelte`（详情）。
工作区布局 `workspace/+layout.svelte` 纯文字 tab "Knowledge"，权限门槛 `$user.permissions.workspace.knowledge`。
列表 `workspace/Knowledge.svelte`：搜索防抖 300ms、created/shared 视图、按 name/updated_at 排序、无限滚动 30/页；
行内菜单：打开/Access/Export(admin zip)/删除。
新建弹窗字段：name、description、accessGrants[]（默认私有仅 owner）。
详情 `KnowledgeBase.svelte`：名称描述编辑、AccessButton、"+"AddContentMenu = 新建目录/上传文件/上传目录/同步目录(sha256 diff)/网页/纯文本；
文件树 30/页、EntryRow 显示处理状态(pending/processing)、重命名/拖拽移动/下载。
聊天引用：`#`/`@` 触发 CommandSuggestionList → collection/file，提交进 metadata.files。
模型绑定：model.info.meta.knowledge。

API（backend/open_webui/routers/knowledge.py 2429 行）：
GET / 与 /search；POST /create（has_permission('workspace.knowledge')）；
POST /{id}/file/add → process_file(collection_name=knowledge.id)；
batch/add、sync/diff、export(admin)、reset、dirs CRUD。

数据层：
- knowledge(id,user_id,name,description,meta,created_at,updated_at) + access_grants(user/group read/write)
- knowledge_file(id,knowledge_id FK,file_id FK,directory_id,user_id)
- knowledge_directory(parent_id 自引用树)
- file(id,user_id,hash,filename,path,data{content,status,error,metadata},meta)

管线：PDFLoader(pypdf)/Text/CSV/Unstructured(docx/pptx/xlsx/epub) → MarkdownHeader+RecursiveCharacterTextSplitter(CHUNK 1000/overlap 100) → embedding(all-MiniLM-L6-v2 默认/openai 可配) → 向量库默认 chroma（每文件 file-{id} + KB 级 knowledge.id 集合）。
检索：LLM 生成多 query → top_k=3 → 混合 BM25+向量(RRF) → rerank(threshold 0.0) → <source> 标签注入 + citation 事件。

上传：POST /api/v1/files/ → Storage(本地 UPLOAD_DIR, 文件名 {uuid}_{name}) → 大小白名单校验 → sha256 → Files.insert_new_file(status=pending) → BackgroundTask process_uploaded_file（audio STT/video 跳过/其他 process_file；metadata.knowledge_id 自动挂链）。
聊天附件：图片压缩不嵌入(process=false)；其余 process=true；拖拽/粘贴/截图(getDisplayMedia)。

## 二、个人中心 Settings

`chat/SettingsModal.svelte`（926 行）单 Modal 页签制（个人+admin:* 前缀页签合并）：
general/interface/notifications/shortcuts/connections/tools/personalization(=Memory)/audio/data_controls/usage/archived_chats/account/about。

Account：UserProfileImage + name/bio/gender/dob → POST /auths/update/profile；UpdatePassword；MFA；API Keys（canUseApiKeys 权限）；JWT(admin)；variables。
头像：**无独立端点**——FileReader+canvas 居中裁 250×250 → toDataURL webp 0.8 → data-URI 直接存 user.profile_image_url(Text)；支持 Remove(/user.png)/Initials/Gravatar。
显示：GET /api/v1/users/{id}/profile/image 按 MIME 白名单 StreamingResponse data:，否则 static/user.png。

settings 服务端为主：user.settings JSON {ui:{...},keybindings}，GET/POST /api/v1/users/user/settings，前端启动拉取 + localStorage 缓存。
Interface schema 50+ 字段（chatBubble/widescreen/richTextInput/ctrlEnterToSend...）。
主题：dark/light/oled-dark/system 写 localStorage.theme。
DataControls：导入/导出/归档/删除全部 chats。Usage：GET /users/usage（totals/heatmap/top_models）。

## 三、Admin 面板

/admin → /admin/users/overview。Users.svelte tab: overview/groups。
UserList：Name/Role/Email/LastActive/CreatedAt；EditUserModal：头像/role(pending/user/admin)/name/email/密码重置(断会话)/Sign out all devices/OAuth sessions；AddUserModal；UserChatsModal（admin 查看用户 chats，ENABLE_ADMIN_CHAT_ACCESS）。
Groups：EditGroupModal tabs general/permissions/users；父子层级 parent_group_id；Default Permissions 按钮改全局默认。

权限数据结构（routers/users.py UserPermissions）：
workspace{models,knowledge,prompts,tools,skills+import/export}
sharing{...public_*}
chat{controls,valves,system_prompt,params,file_upload,web_upload,delete,delete_message,continue_response,regenerate_response,rate_response,edit,share,export,import,stt,tts,call,multiple_models,temporary,temporary_enforced}
features{api_keys,notes,channels,folders,direct_tool_servers,web_search,image_generation,code_interpreter,memories,automations,...}
settings{interface}
存储：group.permissions JSON + config 'user.permissions' 默认；多组取最宽松(get_permissions)；点分判定 has_permission(user,'chat.delete')；session 接口内嵌 permissions 给前端。

**配额：OpenWebUI 无用户级 quota**（无额度/存储上限字段）。
**审计：utils/audit.py 纯 loguru 日志**（AuditLoggingMiddleware，PUT/PATCH/DELETE/POST + 永远记 signin/signup；脱敏；无 DB 无 UI）。
统计：admin Analytics Dashboard → /api/v1/analytics/{summary,models,users,daily,tokens}，chart.js 4。
公告：admin General → Interface/Banners → POST /configs/banners 存 config ui.banners；BannerModel{id,type(info/warning/error/success),title,content,dismissible,timestamp}；Navbar 渲染，dismissible 存 localStorage；启动拉取（无实时 WS）。

User 表：id,email,username,role,name,profile_image_url,bio,gender,dob,timezone,presence,info JSON,variables JSON,settings JSON,oauth,last_active_at...
auth 表：password argon2/bcrypt；api_key 表 {id,user_id,key,data,expires_at,last_used_at}。
首用户自动 admin + enable_signup=False。

## 四、聊天会话管理

侧栏 Sidebar.svelte(~1800行)+Section/Folders/RecursiveFolder/ChatItem/ChatMenu；store chatList.ts（pinned+chats 60/页）。
时间分组 Today/Yesterday；文件夹树拖拽（dataTransfer type:'chat'/'folder'）→ update_chat_folder_id / folder parent update。
ChatMenu 全量：Share/Download(json/txt/pdf)/Rename/Mark as unread/Pin/Clone/Move/Archive/Delete（权限 chat.{share,export,import,delete}）。
搜索：SearchModal（Ctrl+K，debounce 180ms，kind chat|message|note，scope folder: 递归）；SQL 匹配 title+JSON 抽取消息内容，前缀 tag:/folder:/pinned:/archived:/shared:。

Fork：仅消息级（ResponseMessage 工具条，done 后显示）+ /fork 命令；POST /chats/{id}/fork {message_id}；
build_fork_history 沿 parentId 上溯只复制当前分支链（不复制兄弟分支），重建单链树 currentId=source；未完成 assistant 标 done；title+" (fork)"，meta.forked_from；继承 folder/variables/pinned。Clone=全量复制。
消息树：chat.history.messages{id:{parentId,childrenIds,...}}+currentId；chat_message 规范化表； siblings>1 显示 ‹› i/N 切换，getDeepestChildId 落点；用户编辑消息产生新兄弟分支。

分享：POST /chats/{id}/share → shared_chat{token=uuid,chat JSON 快照,share_mode:null|'continue'}；GET /chats/share/{share_id} 匿名（get_optional_verified_user）；前端 /s/[id] 匿名路由；AccessGrants 控共享范围；DELETE 取消。
社区分享开关：ENABLE_COMMUNITY_SHARING → config.features；分享到官方=纯前端 window.open+postMessage。

未读：Chat.last_read_at；unread = updatedAt > max(last_read_at, viewedAt) → 蓝点；POST /chats/{id}/unread 标未读；POST /chats/read 全部已读（侧栏 ⋯ 菜单）；folders 返回 unread_count 聚合。
滚动锁定：autoScroll = scrollHeight-scrollTop <= clientHeight+5（贴底才 true，上翻即解锁）；生成中 rAF 节流滚动；{#if !autoScroll} 悬浮 ↓ 回到底部按钮。
归档：无独立路由，Settings tab archived_chats；GET /chats/archived；POST /chats/{id}/archive toggle；POST /chats/unarchive/all 全恢复；导出按钮。批量删除无多选（仅逐条+权限）。

数据隔离（models/chats.py）：
Chat{id,user_id,chat JSON,meta,variables,folder_id,pinned,archived,share_id,last_read_at,current_message_id}+user_id 组合索引；
写路径 owner-only（get_chat_by_id_and_user_id）；admin 也不能写别人 chat（delete 例外 ENABLE_ADMIN_CHAT_ACCESS）；
读 get_accessible_chat_by_id：owner/admin(read)/shared continue+AccessGrants/folder 共享。
Folder.user_id、Tag 主键(id,user_id)、Memory.user_id+向量 collection 前缀 user-memory-{uid}（唯一存储前缀隔离）、Prompt/File user_id。
文件存储平铺 uuid 无前缀隔离（纯 API 层校验）。

## 五、插件/记忆/图像/Pyodide

Function 表{id,version_id,user_id,name,type(pipe|filter|action|event),content(Python 源码),meta,valves,is_active,is_global}+history 表；Tool 表{specs JSON}。
frontmatter（title/description/version/requirements 自动 pip）→ exec 动态模块缓存（按 content 比对）。
挂载：inlet(请求前 filter)→模型 tool_calls 执行→stream(逐 delta filter)→outlet(完成后)。
pipe=假模型(manifold {fid}.{sub_id})；Action=消息按钮；魔术参数 __event_emitter__/__user__(含 UserValves)/__metadata__。
API /api/v1/functions|tools CRUD+toggle+valves+export+load/url(admin 导入)。
UI：admin/Functions.svelte（CodeMirror 编辑器/启用/全局/Valves modal）；workspace/Tools。

Memory 表{id,user_id,type('user'|'context'),path,content,meta}；注入：features.memory+enable+权限 → 最近 7 条消息为 query 向量检索 k=8 + type=user 全量 → <memory_context> append system（限 2000 字符）；提取：每 review_interval_turns(10) 轮 LLM 生成 {operations:[add/replace/move/remove]}；UI Personalization.svelte。

图像：routers/images.py 引擎 ''/automatic1111/comfyui/openai/gemini；POST /generations → b64/URL 下载 → storage 存为 file → 消息 files 渲染；聊天内开关 features.image_generation + 独立页 /playground/images。

Pyodide：CodeBlock lang=python + features.enable_code_execution → Run → engine jupyter 走 API 否则 executePythonAsWorker（import 扫描 micropip 预装、60s 超时、matplotlib png 转 files）；本地打包 /pyodide/（scripts/prepare-pyodide.js）；worker(IDBFS /mnt)或 sandbox iframe；全局共享实例。

## 六、ZCode 现状基线（差距对照）

已有（可直接利用/增强）：
- users.db(node:sqlite WAL)：users/sessions/groups+group_members(点分权限键 DEFAULT_USER_PERMISSIONS)/invites/shares/prompts/kb_docs+kb_chunks+kb_fts(FTS5)/events(审计)/api_tokens(sha256)
- 平台端点：auth setup-status|register|login|logout|change-password|me；admin config/users/groups/invites/stats/events；tokens CRUD；/v1/models+/v1/chat/completions(Bearer sk-zc- 纯透传无计量)；resources/shares CRUD+/s/:token；search config/providers/search；prompts CRUD；kb CRUD+/kb/search；announcement；browser/status；healthz
- 前端：PlatformAuthPage 登录门；Root.tsx；WorkspaceSidebar+TaskList；SettingsPage tab 制(general/appearance/.../platform/platformAdmin)；PlatformSection(改密+ApiTokens+Prompts)；PlatformAdminSection 8 Tab(Users/Invites/Groups/System/Search/Browser/Knowledge/Usage)
- 上传：useComposerAttachments(临时文件附件) + attachments.tsx 渲染；i18n zh-CN.ts 7054 行
- 知识库雏形：管理员粘贴/上传纯文本 ≤4MB → chunk 200-800 → FTS5（无向量/无多格式/无用户级）

**致命差距（P0）**：CLI 会话 ~/.zcode/cli/db/db.sqlite 全平台共享无 user_id；任务索引 tasks-index.sqlite 共享；provider_config.json 互相覆盖；workspace 单一 cwd 共享；分享资源列表列出所有人 session/task。

已知错误根因：
- Unknown channel window-controller：web 无桌面 Host，良性噪声（useGroupedTaskView hydratingEndpointKeys 依赖它）→ 静默处理
- marketing-touch.query FAIL：内网外联 z.ai 营销接口失败 → 独立部署时容错/禁用
- Docker CLI 崩溃：@zcode/cli 依赖链缺 dist（已修 1b16bdd）

## 七、实施优先级（本仓库路线图）

P0 安全隔离：每用户 HOME 重定向（ZCODE 用户目录注入 CLI spawn env）+ 每用户 workspace cwd + 会话/任务/配置天然隔离
P0 修错：window-controller 静默 + marketing-touch 独立部署容错
P1 用户中心：头像(canvas 250×250→data-URI) + Settings 页签制(General/Account/About/DataControls) + 用户菜单
P1 知识库：文件上传管线(多格式提取/分块/进度) + KB 独立工作区页面(列表/详情/目录树/# 引用) + 每用户隔离 + FTS5 强化(混合排序)
P1 聊天管理：文件夹/标签/置顶/归档/Fork/未读+全部已读/滚动锁定/Ctrl+K 搜索/分享管理
P2 管理台：细粒度权限 UI(对齐 UserPermissions 五域) / 审计 UI(events 表已有) / 统计图表(chart.js) / 公告 Banner 渲染 / 管理员查看用户会话
P3 扩展：图像生成(OpenAI 兼容透传) / Function 插件( eval 沙箱分阶段) / 记忆平台化 / Pyodide / 配额计量
