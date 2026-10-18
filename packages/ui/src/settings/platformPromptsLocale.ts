/** 「提示词」分区文案（中/英双语；OpenWebUI /workspace/prompts 对应）。 */

export interface PlatformPromptsCopy {
  platformDisabledHint: string;
  listTitle: string;
  newAction: string;
  searchPlaceholder: string;
  viewAll: string;
  viewCreated: string;
  viewShared: string;
  allTags: string;
  emptyHint: string;
  badgeGlobal: string;
  badgeReadOnly: string;
  badgeDisabled: string;
  byOwner: string;
  nameLabel: string;
  commandLabel: string;
  commandHint: string;
  variableHint: string;
  tagsLabel: string;
  tagsPlaceholder: string;
  contentLabel: string;
  contentPlaceholder: string;
  globalToggle: string;
  saveAction: string;
  cancelAction: string;
  deleteAction: string;
  yesAction: string;
  editAction: string;
  copyAction: string;
  copiedHint: string;
  savedHint: string;
  insertHint: string;
  loadFailed: string;
  savingAction: string;
  toggleOffHint: string;
  toggleOnHint: string;
}

const PLATFORM_PROMPTS_COPY: Record<"zh-CN" | "en-US", PlatformPromptsCopy> = {
  "zh-CN": {
    platformDisabledHint: "平台账号体系未启用，提示词库仅对平台用户开放。",
    listTitle: "提示词",
    newAction: "新建提示词",
    searchPlaceholder: "搜索提示词…",
    viewAll: "全部",
    viewCreated: "我创建的",
    viewShared: "他人分享",
    allTags: "全部标签",
    emptyHint: "还没有提示词。新建一条并设置 /命令，聊天输入框里即可快速展开。",
    badgeGlobal: "全局",
    badgeReadOnly: "只读",
    badgeDisabled: "已停用",
    byOwner: "由 {owner}",
    nameLabel: "名称",
    commandLabel: "斜杠命令（可选）",
    commandHint: "聊天输入框输入 /命令 即可展开此提示词；仅字母/数字/-_，自动随名称生成。",
    variableHint: "内容中可用 {{变量}} 占位，展开时逐个填写。",
    tagsLabel: "标签（逗号分隔）",
    tagsPlaceholder: "例如：编程, 写作",
    contentLabel: "提示词内容",
    contentPlaceholder: "写一段 50 字以内的摘要，主题是 {{主题}}…",
    globalToggle: "设为全局（所有用户可见）",
    saveAction: "保存",
    cancelAction: "取消",
    deleteAction: "删除",
    yesAction: "确认",
    editAction: "编辑",
    copyAction: "复制",
    copiedHint: "内容已复制",
    savedHint: "已保存",
    insertHint: "聊天输入框输入 / 即可看到该命令。",
    loadFailed: "加载失败",
    savingAction: "处理中…",
    toggleOffHint: "已停用，聊天 / 面板不再出现",
    toggleOnHint: "已启用",
  },
  "en-US": {
    platformDisabledHint: "Platform account system is disabled. Prompts are available to platform users only.",
    listTitle: "Prompts",
    newAction: "New Prompt",
    searchPlaceholder: "Search prompts…",
    viewAll: "All",
    viewCreated: "Created by you",
    viewShared: "Shared with you",
    allTags: "All tags",
    emptyHint: "No prompts yet. Create one with a /command to expand it instantly in chat.",
    badgeGlobal: "Global",
    badgeReadOnly: "Read Only",
    badgeDisabled: "Disabled",
    byOwner: "By {owner}",
    nameLabel: "Name",
    commandLabel: "Slash command (optional)",
    commandHint: "Type /command in chat to expand this prompt; letters/digits/-_ only, auto-generated from name.",
    variableHint: "Use {{variable}} placeholders; fill them in when expanding.",
    tagsLabel: "Tags (comma separated)",
    tagsPlaceholder: "e.g. coding, writing",
    contentLabel: "Prompt content",
    contentPlaceholder: "Write a summary in 50 words about {{topic}}…",
    globalToggle: "Make global (visible to all users)",
    saveAction: "Save",
    cancelAction: "Cancel",
    deleteAction: "Delete",
    yesAction: "Confirm",
    editAction: "Edit",
    copyAction: "Copy",
    copiedHint: "Copied",
    savedHint: "Saved",
    insertHint: "Type / in chat input to see this command.",
    loadFailed: "Load failed",
    savingAction: "Working…",
    toggleOffHint: "Disabled — hidden from chat / panel",
    toggleOnHint: "Enabled",
  },
};

export function getPlatformPromptsCopy(locale: string): PlatformPromptsCopy {
  return PLATFORM_PROMPTS_COPY[locale === "en-US" ? "en-US" : "zh-CN"];
}
