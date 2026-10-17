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
  },
} as const;

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
