/**
 * 平台分区文案（「平台中心」+「平台管理」）：与官方 WebLoginPage/webAuthLocale
 * 同一套做法——分区内部文案不走全局 i18n 键表，语言跟随当前界面语言。
 */

export type PlatformLocale = "zh-CN" | "en-US";

export interface PlatformSectionCopy {
  platformDisabledHint: string;
  accountTitle: string;
  accountDescription: string;
  roleAdmin: string;
  roleUser: string;
  rolePending: string;
  statusActive: string;
  statusDisabled: string;
  changePasswordTitle: string;
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
  updatePasswordAction: string;
  passwordUpdated: string;
  sharesTitle: string;
  sharesDescription: string;
  shareEmpty: string;
  colTitle: string;
  colType: string;
  colVisibility: string;
  colViews: string;
  colCreated: string;
  colActions: string;
  typeSession: string;
  typeTask: string;
  typeProject: string;
  visibilityOpen: string;
  visibilityPublic: string;
  openAction: string;
  copyLinkAction: string;
  linkCopied: string;
  refreshAction: string;
  refreshDone: string;
  deleteAction: string;
  confirmDeleteShare: string;
  yesAction: string;
  cancelAction: string;
  saveAction: string;
  savingAction: string;
  loadFailed: string;
  promptsTitle: string;
  promptsDescription: string;
  promptEmpty: string;
  createPromptAction: string;
  promptTitleLabel: string;
  promptContentLabel: string;
  promptGlobalToggle: string;
  promptGlobalBadge: string;
  promptCopied: string;
  promptSaved: string;
  confirmDeletePrompt: string;
  editAction: string;
}

export interface PlatformAdminSectionCopy extends PlatformSectionCopy {
  tabUsers: string;
  tabInvites: string;
  tabGroups: string;
  tabSystem: string;
  tabSearch: string;
  tabBrowser: string;
  usersTitle: string;
  usersDescription: string;
  createUserAction: string;
  createUsername: string;
  createPassword: string;
  createRole: string;
  colUsername: string;
  colRole: string;
  colStatus: string;
  colGroups: string;
  colCreated: string;
  colLastLogin: string;
  actionApprove: string;
  actionMakeAdmin: string;
  actionMakeUser: string;
  actionDisable: string;
  actionEnable: string;
  actionResetPassword: string;
  actionDelete: string;
  newUserPasswordPrompt: string;
  noGroups: string;
  youLabel: string;
  invitesTitle: string;
  invitesDescription: string;
  inviteEmpty: string;
  createInviteAction: string;
  inviteMaxUses: string;
  inviteExpiresDays: string;
  inviteDefaultRole: string;
  inviteNote: string;
  inviteCodeCol: string;
  inviteUsesCol: string;
  inviteExpiresCol: string;
  inviteStatusCol: string;
  inviteUnlimited: string;
  inviteNeverExpires: string;
  inviteStatusActive: string;
  inviteStatusDisabled: string;
  inviteStatusExhausted: string;
  inviteStatusExpired: string;
  inviteCopyAction: string;
  groupsTitle: string;
  groupsDescription: string;
  createGroupAction: string;
  groupNameLabel: string;
  groupDescriptionLabel: string;
  groupMembersLabel: string;
  groupPermissionsLabel: string;
  permChatShare: string;
  permSharingPublic: string;
  groupEmpty: string;
  systemTitle: string;
  systemDescription: string;
  configEnableSignup: string;
  configRequireInvite: string;
  configDefaultRole: string;
  configLoginNotice: string;
  configPendingNotice: string;
  configSaved: string;
  searchTitle: string;
  searchDescription: string;
  searchProvider: string;
  searchApiKey: string;
  searchApiToken: string;
  searchBaseUrl: string;
  searchCount: string;
  searchSaved: string;
  browserTitle: string;
  browserDescription: string;
  browserEnabled: string;
  browserDisabled: string;
  browserEndpoint: string;
  browserMode: string;
  browserProbeAction: string;
  browserConnected: string;
  browserDisconnected: string;
  tabKnowledge: string;
  tabUsage: string;
  kbTitle: string;
  kbDescription: string;
  kbEmpty: string;
  kbUploadAction: string;
  kbDocTitleLabel: string;
  kbFilenameLabel: string;
  kbContentLabel: string;
  kbContentHint: string;
  kbUploaded: string;
  kbDeleteConfirm: string;
  colSize: string;
  colChunks: string;
  usageTitle: string;
  usageDescription: string;
  statUsers: string;
  statPending: string;
  statSessions: string;
  statShares: string;
  statPrompts: string;
  statKbDocs: string;
  statLogins24h: string;
  statSearches24h: string;
  auditTitle: string;
  auditDescription: string;
  auditEmpty: string;
  auditFilterAll: string;
  colEvent: string;
  colDetail: string;
  configAnnouncementEnabled: string;
  configAnnouncementTitle: string;
  configAnnouncementBody: string;
}

const PLATFORM_SECTION_COPY = {
  "zh-CN": {
    platformDisabledHint:
      "平台账号体系未启用（服务端未开启 ZCODE_PLATFORM_AUTH）。当前使用官方默认登录方式。",
    accountTitle: "账号",
    accountDescription: "平台账号信息与安全设置。",
    roleAdmin: "管理员",
    roleUser: "成员",
    rolePending: "待审批",
    statusActive: "正常",
    statusDisabled: "已停用",
    changePasswordTitle: "修改密码",
    currentPassword: "当前密码",
    newPassword: "新密码",
    confirmNewPassword: "确认新密码",
    updatePasswordAction: "更新密码",
    passwordUpdated: "密码已更新",
    sharesTitle: "我的分享",
    sharesDescription: "对话 / 任务 / 项目的快照分享链接，公开分享无需登录即可访问。",
    shareEmpty: "还没有分享。在工作台中选择资源创建分享链接。",
    colTitle: "标题",
    colType: "类型",
    colVisibility: "可见性",
    colViews: "浏览",
    colCreated: "创建时间",
    colActions: "操作",
    typeSession: "对话",
    typeTask: "任务",
    typeProject: "项目",
    visibilityOpen: "公开",
    visibilityPublic: "登录可见",
    openAction: "打开",
    copyLinkAction: "复制链接",
    linkCopied: "链接已复制",
    refreshAction: "刷新快照",
    refreshDone: "快照已更新",
    deleteAction: "删除",
    confirmDeleteShare: "确认删除该分享？删除后链接立即失效。",
    yesAction: "确认",
    cancelAction: "取消",
    saveAction: "保存",
    savingAction: "保存中…",
    loadFailed: "加载失败",
    promptsTitle: "提示词库",
    promptsDescription: "个人与全平台的提示词模板，复制后粘贴到任务输入框即可使用。",
    promptEmpty: "还没有提示词。点击「新建提示词」创建第一条模板。",
    createPromptAction: "新建提示词",
    promptTitleLabel: "标题",
    promptContentLabel: "内容",
    promptGlobalToggle: "设为全局（所有用户可见，仅管理员）",
    promptGlobalBadge: "全局",
    promptCopied: "已复制到剪贴板",
    promptSaved: "已保存",
    confirmDeletePrompt: "确认删除该提示词？",
    editAction: "编辑",
  },
  "en-US": {
    platformDisabledHint:
      "Platform account system is disabled (ZCODE_PLATFORM_AUTH is off on the server). Official sign-in flow is used.",
    accountTitle: "Account",
    accountDescription: "Platform account profile and security.",
    roleAdmin: "Admin",
    roleUser: "Member",
    rolePending: "Pending",
    statusActive: "Active",
    statusDisabled: "Disabled",
    changePasswordTitle: "Change Password",
    currentPassword: "Current password",
    newPassword: "New password",
    confirmNewPassword: "Confirm new password",
    updatePasswordAction: "Update Password",
    passwordUpdated: "Password updated",
    sharesTitle: "My Shares",
    sharesDescription: "Snapshot share links for conversations / tasks / projects. Public links need no sign-in.",
    shareEmpty: "No shares yet. Create one from the workbench.",
    colTitle: "Title",
    colType: "Type",
    colVisibility: "Visibility",
    colViews: "Views",
    colCreated: "Created",
    colActions: "Actions",
    typeSession: "Conversation",
    typeTask: "Task",
    typeProject: "Project",
    visibilityOpen: "Public",
    visibilityPublic: "Sign-in required",
    openAction: "Open",
    copyLinkAction: "Copy Link",
    linkCopied: "Link copied",
    refreshAction: "Refresh Snapshot",
    refreshDone: "Snapshot refreshed",
    deleteAction: "Delete",
    confirmDeleteShare: "Delete this share? The link stops working immediately.",
    yesAction: "Confirm",
    cancelAction: "Cancel",
    saveAction: "Save",
    savingAction: "Saving…",
    loadFailed: "Failed to load",
    promptsTitle: "Prompt Library",
    promptsDescription: "Personal and platform-wide prompt templates. Copy and paste into the task composer.",
    promptEmpty: "No prompts yet. Create your first template.",
    createPromptAction: "New Prompt",
    promptTitleLabel: "Title",
    promptContentLabel: "Content",
    promptGlobalToggle: "Make global (visible to all users, admin only)",
    promptGlobalBadge: "Global",
    promptCopied: "Copied to clipboard",
    promptSaved: "Saved",
    confirmDeletePrompt: "Delete this prompt?",
    editAction: "Edit",
  },
} as const;

const ADMIN_EXTRA_COPY = {
  "zh-CN": {
    tabUsers: "用户",
    tabInvites: "邀请码",
    tabGroups: "用户组",
    tabSystem: "系统",
    tabSearch: "联网搜索",
    tabBrowser: "浏览器桥",
    usersTitle: "用户管理",
    usersDescription: "平台账号、角色与审批。",
    createUserAction: "创建用户",
    createUsername: "用户名",
    createPassword: "初始密码",
    createRole: "角色",
    colUsername: "用户名",
    colRole: "角色",
    colStatus: "状态",
    colGroups: "用户组",
    colCreated: "创建时间",
    colLastLogin: "最近登录",
    actionApprove: "通过审批",
    actionMakeAdmin: "设为管理员",
    actionMakeUser: "设为成员",
    actionDisable: "停用",
    actionEnable: "启用",
    actionResetPassword: "重置密码",
    actionDelete: "删除",
    newUserPasswordPrompt: "输入该用户的新密码：",
    noGroups: "—",
    youLabel: "（我）",
    invitesTitle: "邀请码",
    invitesDescription: "受控准入：注册邀请码的使用次数、有效期与默认角色。",
    inviteEmpty: "还没有邀请码。",
    createInviteAction: "生成邀请码",
    inviteMaxUses: "最多使用次数（0 为不限）",
    inviteExpiresDays: "有效天数（0 为永久）",
    inviteDefaultRole: "注册后默认角色",
    inviteNote: "备注",
    inviteCodeCol: "邀请码",
    inviteUsesCol: "使用",
    inviteExpiresCol: "过期时间",
    inviteStatusCol: "状态",
    inviteUnlimited: "不限",
    inviteNeverExpires: "永久",
    inviteStatusActive: "有效",
    inviteStatusDisabled: "已停用",
    inviteStatusExhausted: "已用尽",
    inviteStatusExpired: "已过期",
    inviteCopyAction: "复制",
    groupsTitle: "用户组",
    groupsDescription: "按组授予分享等能力权限（has_permission OR-over-groups）。",
    createGroupAction: "创建用户组",
    groupNameLabel: "组名",
    groupDescriptionLabel: "描述",
    groupMembersLabel: "成员",
    groupPermissionsLabel: "权限",
    permChatShare: "允许分享（chat.share）",
    permSharingPublic: "允许公开分享（sharing.public）",
    groupEmpty: "还没有用户组。",
    systemTitle: "系统设置",
    systemDescription: "注册策略与站点公告，保存后即时生效。",
    configEnableSignup: "开放注册",
    configRequireInvite: "注册需要邀请码",
    configDefaultRole: "新用户默认角色",
    configLoginNotice: "登录页公告",
    configPendingNotice: "待审批提示文案",
    configSaved: "已保存",
    searchTitle: "联网搜索服务",
    searchDescription: "为 Agent 的 platform-web-search MCP 工具提供上游搜索源。",
    searchProvider: "搜索 Provider",
    searchApiKey: "上游 API Key",
    searchApiToken: "对外访问 Token（留空则不鉴权）",
    searchBaseUrl: "自定义 Endpoint（可选）",
    searchCount: "默认返回条数",
    searchSaved: "搜索配置已保存",
    browserTitle: "远程浏览器桥",
    browserDescription: "Agent 浏览器操控经远程 Playwright/CDP 容器执行。",
    browserEnabled: "已启用",
    browserDisabled: "未启用（设置 ZCODE_BROWSER_REMOTE_ENDPOINT 开启）",
    browserEndpoint: "端点",
    browserMode: "模式",
    browserProbeAction: "探测连通性",
    browserConnected: "已连接",
    browserDisconnected: "未连接",
    tabKnowledge: "知识库",
    tabUsage: "用量/审计",
    kbTitle: "平台知识库",
    kbDescription: "管理员上传私有文档（txt/md/代码等文本），Agent 通过 search_knowledge 工具自动检索引用。",
    kbEmpty: "知识库为空。上传第一份文档让 Agent 获得私有知识。",
    kbUploadAction: "上传文档",
    kbDocTitleLabel: "文档标题",
    kbFilenameLabel: "文件名（可选）",
    kbContentLabel: "文档内容",
    kbContentHint: "支持粘贴任意文本（Markdown/纯文本/代码），空行分段会被用作检索分块边界。",
    kbUploaded: "文档已入库并建立全文索引",
    kbDeleteConfirm: "确认删除该文档？其全文索引将一并移除。",
    colSize: "大小",
    colChunks: "分块",
    usageTitle: "平台用量",
    usageDescription: "近 24 小时与全量资源统计。",
    statUsers: "用户总数",
    statPending: "待审批",
    statSessions: "活跃会话",
    statShares: "分享总数",
    statPrompts: "提示词",
    statKbDocs: "知识文档",
    statLogins24h: "24h 登录",
    statSearches24h: "24h 搜索",
    auditTitle: "审计日志",
    auditDescription: "登录、分享、搜索与内容变更的完整审计轨迹（保留最近 10000 条）。",
    auditEmpty: "暂无事件。",
    auditFilterAll: "全部",
    colEvent: "事件",
    colDetail: "详情",
    configAnnouncementEnabled: "启用工作台公告横幅",
    configAnnouncementTitle: "公告标题",
    configAnnouncementBody: "公告内容",
  },
  "en-US": {
    tabUsers: "Users",
    tabInvites: "Invites",
    tabGroups: "Groups",
    tabSystem: "System",
    tabSearch: "Web Search",
    tabBrowser: "Browser Bridge",
    usersTitle: "User Management",
    usersDescription: "Platform accounts, roles and approvals.",
    createUserAction: "Create User",
    createUsername: "Username",
    createPassword: "Initial password",
    createRole: "Role",
    colUsername: "Username",
    colRole: "Role",
    colStatus: "Status",
    colGroups: "Groups",
    colCreated: "Created",
    colLastLogin: "Last Login",
    actionApprove: "Approve",
    actionMakeAdmin: "Make Admin",
    actionMakeUser: "Make Member",
    actionDisable: "Disable",
    actionEnable: "Enable",
    actionResetPassword: "Reset Password",
    actionDelete: "Delete",
    newUserPasswordPrompt: "Enter a new password for this user:",
    noGroups: "—",
    youLabel: " (me)",
    invitesTitle: "Invite Codes",
    invitesDescription: "Controlled onboarding: usage limits, expiry and default role.",
    inviteEmpty: "No invite codes yet.",
    createInviteAction: "Generate Invite Code",
    inviteMaxUses: "Max uses (0 = unlimited)",
    inviteExpiresDays: "Expires in days (0 = never)",
    inviteDefaultRole: "Default role after signup",
    inviteNote: "Note",
    inviteCodeCol: "Code",
    inviteUsesCol: "Uses",
    inviteExpiresCol: "Expires",
    inviteStatusCol: "Status",
    inviteUnlimited: "Unlimited",
    inviteNeverExpires: "Never",
    inviteStatusActive: "Active",
    inviteStatusDisabled: "Disabled",
    inviteStatusExhausted: "Exhausted",
    inviteStatusExpired: "Expired",
    inviteCopyAction: "Copy",
    groupsTitle: "User Groups",
    groupsDescription: "Grant permissions like sharing per group (has_permission OR-over-groups).",
    createGroupAction: "Create Group",
    groupNameLabel: "Name",
    groupDescriptionLabel: "Description",
    groupMembersLabel: "Members",
    groupPermissionsLabel: "Permissions",
    permChatShare: "Allow sharing (chat.share)",
    permSharingPublic: "Allow public sharing (sharing.public)",
    groupEmpty: "No groups yet.",
    systemTitle: "System Settings",
    systemDescription: "Signup policy and site notices take effect immediately.",
    configEnableSignup: "Enable signup",
    configRequireInvite: "Signup requires invite code",
    configDefaultRole: "Default role for new users",
    configLoginNotice: "Sign-in page notice",
    configPendingNotice: "Pending-approval notice",
    configSaved: "Saved",
    searchTitle: "Web Search Service",
    searchDescription: "Upstream search provider for the agent platform-web-search MCP tool.",
    searchProvider: "Provider",
    searchApiKey: "Upstream API Key",
    searchApiToken: "Public access token (empty = no auth)",
    searchBaseUrl: "Custom endpoint (optional)",
    searchCount: "Default result count",
    searchSaved: "Search config saved",
    browserTitle: "Remote Browser Bridge",
    browserDescription: "Agent browser control executes in a remote Playwright/CDP container.",
    browserEnabled: "Enabled",
    browserDisabled: "Disabled (set ZCODE_BROWSER_REMOTE_ENDPOINT to enable)",
    browserEndpoint: "Endpoint",
    browserMode: "Mode",
    browserProbeAction: "Probe",
    browserConnected: "Connected",
    browserDisconnected: "Disconnected",
    tabKnowledge: "Knowledge",
    tabUsage: "Usage & Audit",
    kbTitle: "Platform Knowledge Base",
    kbDescription: "Admin-uploaded documents (txt/md/code). Agents retrieve them via the search_knowledge tool.",
    kbEmpty: "Knowledge base is empty. Upload the first document to ground your agents.",
    kbUploadAction: "Upload Document",
    kbDocTitleLabel: "Title",
    kbFilenameLabel: "Filename (optional)",
    kbContentLabel: "Content",
    kbContentHint: "Paste any text (Markdown/plain/code). Blank-line paragraphs are used as chunk boundaries for retrieval.",
    kbUploaded: "Document indexed",
    kbDeleteConfirm: "Delete this document? Its full-text index is removed too.",
    colSize: "Size",
    colChunks: "Chunks",
    usageTitle: "Platform Usage",
    usageDescription: "Last-24h and all-time resource statistics.",
    statUsers: "Users",
    statPending: "Pending",
    statSessions: "Active Sessions",
    statShares: "Shares",
    statPrompts: "Prompts",
    statKbDocs: "KB Documents",
    statLogins24h: "Logins (24h)",
    statSearches24h: "Searches (24h)",
    auditTitle: "Audit Log",
    auditDescription: "Full audit trail of sign-ins, shares, searches and content changes (last 10000 kept).",
    auditEmpty: "No events yet.",
    auditFilterAll: "All",
    colEvent: "Event",
    colDetail: "Detail",
    configAnnouncementEnabled: "Show workbench announcement banner",
    configAnnouncementTitle: "Announcement title",
    configAnnouncementBody: "Announcement body",
  },
} as const;

/** 审计事件类型的中英文标签（未知类型回退原始 type）。 */
export function platformEventLabel(type: string, locale?: string): string {
  const zh = locale !== undefined ? resolvePlatformLocale(locale) === "zh-CN" : true;
  const labels: Record<string, [string, string]> = {
    "auth.setup_admin": ["初始化管理员", "Admin setup"],
    "auth.register": ["注册", "Sign up"],
    "auth.register_failed": ["注册失败", "Sign-up failed"],
    "auth.login": ["登录", "Sign in"],
    "auth.login_failed": ["登录失败", "Sign-in failed"],
    "auth.logout": ["登出", "Sign out"],
    "share.create": ["创建分享", "Share created"],
    "search.query": ["联网搜索", "Web search"],
    "prompt.create": ["新建提示词", "Prompt created"],
    "kb.create": ["上传知识文档", "KB doc uploaded"],
    "kb.delete": ["删除知识文档", "KB doc deleted"],
  };
  const entry = labels[type];
  if (!entry) return type;
  return zh ? entry[0] : entry[1];
}

function resolvePlatformLocale(language?: string): PlatformLocale {
  const candidate = language ?? document.documentElement.lang ?? navigator.language ?? "";
  return candidate.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function getPlatformSectionCopy(locale?: string): PlatformSectionCopy {
  return PLATFORM_SECTION_COPY[resolvePlatformLocale(locale)];
}

export function getPlatformAdminSectionCopy(locale?: string): PlatformAdminSectionCopy {
  const resolved = resolvePlatformLocale(locale);
  return { ...PLATFORM_SECTION_COPY[resolved], ...ADMIN_EXTRA_COPY[resolved] };
}
