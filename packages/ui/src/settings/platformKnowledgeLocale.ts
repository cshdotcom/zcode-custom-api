/** 「知识库」分区文案（中/英双语，与 platformLocale 同构；collection 两级模型）。 */

export interface PlatformKnowledgeCopy {
  platformDisabledHint: string;
  listTitle: string;
  newAction: string;
  searchPlaceholder: string;
  viewAll: string;
  viewCreated: string;
  viewShared: string;
  emptyHint: string;
  badgeCollection: string;
  filesCount: string;
  byOwner: string;
  updatedAgo: string;
  detailBack: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
  addFiles: string;
  addText: string;
  dropHere: string;
  supportedTypes: string;
  uploadedHint: string;
  textTitlePlaceholder: string;
  textContentPlaceholder: string;
  addTextAction: string;
  textAdded: string;
  filesTitle: string;
  filesEmpty: string;
  colFile: string;
  colChunks: string;
  colSize: string;
  colAddedBy: string;
  colAddedAt: string;
  colActions: string;
  removeAction: string;
  deleteCollection: string;
  deleteConfirm: string;
  searchTitle: string;
  searchPlaceholder: string;
  searchAction: string;
  searchingAction: string;
  searchEmpty: string;
  loadFailed: string;
  savingAction: string;
  extractFailed: string;
  deleteFileToo: string;
}

const PLATFORM_KNOWLEDGE_COPY: Record<"zh-CN" | "en-US", PlatformKnowledgeCopy> = {
  "zh-CN": {
    platformDisabledHint: "平台账号体系未启用，知识库仅对平台用户开放。",
    listTitle: "知识库",
    newAction: "新建知识库",
    searchPlaceholder: "搜索知识库…",
    viewAll: "全部",
    viewCreated: "我创建的",
    viewShared: "他人分享",
    emptyHint: "还没有知识库。点击「新建知识库」创建第一座，把常用文档沉淀为 agent 可检索的知识。",
    badgeCollection: "知识库",
    filesCount: "{count} 个文件",
    byOwner: "由 {owner}",
    updatedAgo: "更新于 {time}",
    detailBack: "返回列表",
    namePlaceholder: "知识库名称",
    descriptionPlaceholder: "描述这个知识库的用途（可选）",
    addFiles: "上传文件",
    addText: "添加文本",
    dropHere: "点击选择或拖拽文件到此处",
    supportedTypes: "支持 txt / md / 代码 / docx / pdf（单文件 ≤ 20MB）",
    uploadedHint: "已上传 {name}（提取 {chars} 字符）",
    textTitlePlaceholder: "内容标题",
    textContentPlaceholder: "粘贴要入库的文本内容…",
    addTextAction: "添加",
    textAdded: "内容已添加到知识库",
    filesTitle: "文件",
    filesEmpty: "还没有文件。上传文件或添加文本内容开始使用。",
    colFile: "文件",
    colChunks: "分块",
    colSize: "大小",
    colAddedBy: "添加者",
    colAddedAt: "添加时间",
    colActions: "操作",
    removeAction: "移除",
    deleteCollection: "删除知识库",
    deleteConfirm: "删除后库内文件的索引一并清除，且不可恢复。确定删除「{name}」？",
    searchTitle: "库内检索",
    searchPlaceholder: "输入关键词，回车检索",
    searchAction: "检索",
    searchingAction: "检索中…",
    searchEmpty: "没有命中的内容。",
    loadFailed: "加载失败",
    savingAction: "处理中…",
    extractFailed: "文本抽取失败",
    deleteFileToo: "同时删除文件本体",
  },
  "en-US": {
    platformDisabledHint: "Platform account system is disabled. Knowledge base is available to platform users only.",
    listTitle: "Knowledge",
    newAction: "New Knowledge",
    searchPlaceholder: "Search knowledge…",
    viewAll: "All",
    viewCreated: "Created by you",
    viewShared: "Shared with you",
    emptyHint: "No knowledge yet. Create your first collection to make documents retrievable by agents.",
    badgeCollection: "Collection",
    filesCount: "{count} files",
    byOwner: "By {owner}",
    updatedAgo: "Updated {time}",
    detailBack: "Back to list",
    namePlaceholder: "Knowledge name",
    descriptionPlaceholder: "Describe what this knowledge is for (optional)",
    addFiles: "Upload files",
    addText: "Add text",
    dropHere: "Click to select or drag files here",
    supportedTypes: "Supports txt / md / code / docx / pdf (max 20MB each)",
    uploadedHint: "Uploaded {name} ({chars} chars extracted)",
    textTitlePlaceholder: "Content title",
    textContentPlaceholder: "Paste the text to store…",
    addTextAction: "Add",
    textAdded: "Content added to knowledge",
    filesTitle: "Files",
    filesEmpty: "No files yet. Upload files or add text to get started.",
    colFile: "File",
    colChunks: "Chunks",
    colSize: "Size",
    colAddedBy: "Added by",
    colAddedAt: "Added",
    colActions: "Actions",
    removeAction: "Remove",
    deleteCollection: "Delete Knowledge",
    deleteConfirm: "Indexes of all files will be removed. This cannot be undone. Delete \"{name}\"?",
    searchTitle: "Search in collection",
    searchPlaceholder: "Type keywords and press Enter",
    searchAction: "Search",
    searchingAction: "Searching…",
    searchEmpty: "No matches found.",
    loadFailed: "Load failed",
    savingAction: "Working…",
    extractFailed: "Text extraction failed",
    deleteFileToo: "Also delete the file itself",
  },
};

export function getPlatformKnowledgeCopy(locale: string): PlatformKnowledgeCopy {
  return PLATFORM_KNOWLEDGE_COPY[locale === "en-US" ? "en-US" : "zh-CN"];
}
