/** 「知识库」分区文案（中/英双语，与 platformLocale 同构）。 */

export interface PlatformKnowledgeCopy {
  platformDisabledHint: string;
  uploadTitle: string;
  uploadDescription: string;
  dropHere: string;
  supportedTypes: string;
  uploadedHint: string;
  addTextTitle: string;
  textTitlePlaceholder: string;
  textContentPlaceholder: string;
  addTextAction: string;
  textAdded: string;
  searchTitle: string;
  searchDescription: string;
  searchPlaceholder: string;
  searchAction: string;
  searchingAction: string;
  searchEmpty: string;
  docsTitle: string;
  docsDescription: string;
  docsDescriptionAdmin: string;
  docsEmpty: string;
  colTitle: string;
  colChunks: string;
  colSize: string;
  colOwner: string;
  colCreated: string;
  colActions: string;
  deleteAction: string;
  loadFailed: string;
  savingAction: string;
}

const PLATFORM_KNOWLEDGE_COPY: Record<"zh-CN" | "en-US", PlatformKnowledgeCopy> = {
  "zh-CN": {
    platformDisabledHint: "平台账号体系未启用，知识库仅对平台用户开放。",
    uploadTitle: "上传文档",
    uploadDescription: "上传后自动提取文本、分块并建立全文索引，agent 可在对话中检索引用。",
    dropHere: "点击选择或拖拽文件到此处",
    supportedTypes: "支持 txt / md / 代码 / docx / pdf（单文件 ≤ 20MB）",
    uploadedHint: "已上传 {name}（提取 {chars} 字符）",
    addTextTitle: "添加纯文本内容",
    textTitlePlaceholder: "内容标题",
    textContentPlaceholder: "粘贴要入库的文本内容…",
    addTextAction: "添加到知识库",
    textAdded: "内容已添加到知识库",
    searchTitle: "检索测试",
    searchDescription: "输入关键词预览知识库命中的片段（与 agent 检索同源）。",
    searchPlaceholder: "输入关键词，回车检索",
    searchAction: "检索",
    searchingAction: "检索中…",
    searchEmpty: "没有命中的内容。",
    docsTitle: "文档列表",
    docsDescription: "这里只显示你上传的文档，其他用户不可见。",
    docsDescriptionAdmin: "管理员可见全部用户的文档。",
    docsEmpty: "知识库还是空的。上传文件或添加文本内容开始使用。",
    colTitle: "标题",
    colChunks: "分块",
    colSize: "大小",
    colOwner: "上传者",
    colCreated: "创建时间",
    colActions: "操作",
    deleteAction: "删除",
    loadFailed: "加载失败",
    savingAction: "处理中…",
  },
  "en-US": {
    platformDisabledHint: "Platform account system is disabled. Knowledge base is available to platform users only.",
    uploadTitle: "Upload Documents",
    uploadDescription: "Text is extracted, chunked and full-text indexed on upload; agents can retrieve it in chat.",
    dropHere: "Click to select or drag files here",
    supportedTypes: "Supports txt / md / code / docx / pdf (max 20MB each)",
    uploadedHint: "Uploaded {name} ({chars} chars extracted)",
    addTextTitle: "Add Text Content",
    textTitlePlaceholder: "Content title",
    textContentPlaceholder: "Paste the text to store…",
    addTextAction: "Add to Knowledge",
    textAdded: "Content added to knowledge base",
    searchTitle: "Retrieval Test",
    searchDescription: "Preview knowledge hits by keyword (same source as agent retrieval).",
    searchPlaceholder: "Type keywords and press Enter",
    searchAction: "Search",
    searchingAction: "Searching…",
    searchEmpty: "No matches found.",
    docsTitle: "Documents",
    docsDescription: "Only your own documents are listed here; other users cannot see them.",
    docsDescriptionAdmin: "Admins can see documents from all users.",
    docsEmpty: "Knowledge base is empty. Upload files or add text to get started.",
    colTitle: "Title",
    colChunks: "Chunks",
    colSize: "Size",
    colOwner: "Owner",
    colCreated: "Created",
    colActions: "Actions",
    deleteAction: "Delete",
    loadFailed: "Load failed",
    savingAction: "Working…",
  },
};

export function getPlatformKnowledgeCopy(locale: string): PlatformKnowledgeCopy {
  return PLATFORM_KNOWLEDGE_COPY[locale === "en-US" ? "en-US" : "zh-CN"];
}
