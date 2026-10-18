import {
  Monitor,
  Moon,
  Settings,
  Settings2,
  Package,
  Bot,
  Palette,
  Sun,
  BarChart3,
  Terminal,
  AlarmClock,
  Anchor,
  Brain,
  Blocks,
  CircleUserRound,
  Globe2,
  Cable,
  ShieldCheck,
  WandSparkles,
  Keyboard,
  FileSearch,
  LibraryBig,
  MessageSquareText,
} from "lucide-react";
import { isSettingsSectionEnabled, type SettingsSectionId } from "@/lib/settingsNavigation.js";
import type { Theme } from "@/useTheme.js";

export const THEME_MODES: Array<{
  mode: Theme;
  icon: typeof Sun;
}> = [
  { mode: "system", icon: Monitor },
  { mode: "zai-dark", icon: Moon },
  { mode: "zai-light", icon: Sun },
];

export type SettingsSectionGroupId = "basics" | "agentCapabilities" | "dataAndStats";

interface SettingsSectionDefinition {
  id: SettingsSectionId;
  icon: typeof Settings;
  titleId: string;
  contentTitleId?: string;
  titleBadgeId?: string;
  groupId: SettingsSectionGroupId;
}

const BASE_SETTINGS_SECTION_GROUPS: Array<{
  id: SettingsSectionGroupId;
  titleId: string;
}> = [
  { id: "basics", titleId: "settings.sidebar.group.basics" },
  {
    id: "agentCapabilities",
    titleId: "settings.sidebar.group.agentCapabilities",
  },
  { id: "dataAndStats", titleId: "settings.sidebar.group.dataAndStats" },
];

const BASE_SETTINGS_SECTIONS: SettingsSectionDefinition[] = [
  {
    id: "general",
    icon: Settings2,
    titleId: "settings.systemTitle",
    groupId: "basics",
  },
  {
    id: "appearance",
    icon: Palette,
    titleId: "settings.appearanceTitle",
    groupId: "basics",
  },
  {
    id: "modelProvider",
    icon: Package,
    titleId: "settings.modelProviderTitle",
    groupId: "basics",
  },
  {
    id: "memory",
    icon: Brain,
    titleId: "settings.memory",
    groupId: "agentCapabilities",
  },
  {
    id: "subagents",
    icon: Bot,
    titleId: "settings.subagents.title",
    groupId: "agentCapabilities",
  },
  {
    id: "plugin",
    icon: Blocks,
    titleId: "settings.plugins.title",
    groupId: "agentCapabilities",
  },
  {
    id: "mcp",
    icon: Cable,
    titleId: "settings.mcpTitle",
    groupId: "agentCapabilities",
  },
  {
    id: "skill",
    icon: WandSparkles,
    titleId: "settings.skills.title",
    groupId: "agentCapabilities",
  },
  {
    id: "commands",
    icon: Terminal,
    titleId: "settings.commands.title",
    groupId: "agentCapabilities",
  },
  {
    id: "automations",
    icon: AlarmClock,
    titleId: "settings.automations.title",
    titleBadgeId: "settings.automations.betaBadge",
    groupId: "agentCapabilities",
  },
  {
    id: "hooks",
    icon: Anchor,
    titleId: "settings.hooks.title",
    groupId: "agentCapabilities",
  },
  {
    id: "browser",
    icon: Globe2,
    titleId: "settings.browser.title",
    groupId: "basics",
  },
  // 电脑控制紧跟「浏览器」：两者都是给 Agent 用的本机操控入口，
  // 放在基础设置里让用户在同一处理解「控制浏览器 / 控制整台电脑」的关系。
  {
    id: "computerUse",
    icon: Monitor,
    titleId: "settings.computerUse.title",
    groupId: "basics",
  },
  // 键盘快捷键紧跟「电脑控制」：同属本机操控/效率配置，收纳在基础设置尾部。
  {
    id: "shortcuts",
    icon: Keyboard,
    titleId: "settings.shortcuts.title",
    groupId: "basics",
  },
  // 工作区搜索范围（.zcodeignore）：面向所有用户的基础工作区行为配置，收在基础设置末尾。
  {
    id: "workspaceFileSearch",
    icon: FileSearch,
    titleId: "settings.workspaceFileSearch.title",
    groupId: "basics",
  },
  {
    id: "usage",
    icon: BarChart3,
    titleId: "settings.usageTitle",
    groupId: "dataAndStats",
  },
  // 平台中心：自有用户系统的账号与分享管理（平台认证未启用时按角色过滤隐藏）。
  {
    id: "platform",
    icon: CircleUserRound,
    titleId: "settings.platformTitle",
    groupId: "basics",
  },
  // 平台知识库：OpenWebUI workspace/knowledge 用户级复刻（所有平台用户可见）。
  {
    id: "platformKnowledge",
    icon: LibraryBig,
    titleId: "settings.platformKnowledgeTitle",
    groupId: "basics",
  },
  // 平台提示词：OpenWebUI workspace/prompts 用户级复刻（所有平台用户可见）。
  {
    id: "platformPrompts",
    icon: MessageSquareText,
    titleId: "settings.platformPromptsTitle",
    groupId: "basics",
  },
  // 平台管理：仅平台管理员可见的用户 / 邀请码 / 用户组 / 系统设置控制台。
  {
    id: "platformAdmin",
    icon: ShieldCheck,
    titleId: "settings.platformAdminTitle",
    groupId: "basics",
  },
];

// 兼容既有只读消费者：默认配置代表不带桌面平台能力的 Web 视图；
// macOS/Windows/Linux 必须继续通过 createSettingsPageConfig 动态加入 Computer Use。
// 平台分区依赖登录角色，只读消费方拿不到角色，一律不出现。
export const SETTINGS_SECTIONS = BASE_SETTINGS_SECTIONS.filter(
  (section) =>
    section.id !== "computerUse" &&
    section.id !== "platform" &&
    section.id !== "platformKnowledge" &&
    section.id !== "platformPrompts" &&
    section.id !== "platformAdmin" &&
    isSettingsSectionEnabled(section.id),
);

export interface SettingsPageConfigOptions {
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  /** 平台用户角色：null 表示平台账号体系未启用，两个平台分区均隐藏。 */
  platformRole?: "admin" | "user" | "pending" | null;
}

export function createSettingsPageConfig({
  isDesktop = false,
  isMacDesktop = false,
  isWindowsDesktop = false,
  platformRole = null,
}: SettingsPageConfigOptions = {}) {
  const showComputerUse = isDesktop || isMacDesktop || isWindowsDesktop;
  const showPlatform = platformRole !== null && platformRole !== "pending";
  const showPlatformAdmin = platformRole === "admin";
  const settingsSections = BASE_SETTINGS_SECTIONS.filter((section) => {
    if (section.id === "computerUse" && !showComputerUse) return false;
    if (section.id === "platform" && !showPlatform) return false;
    if (section.id === "platformKnowledge" && !showPlatform) return false;
    if (section.id === "platformPrompts" && !showPlatform) return false;
    if (section.id === "platformAdmin" && !showPlatformAdmin) return false;
    return isSettingsSectionEnabled(section.id);
  });
  const settingsSectionGroups = BASE_SETTINGS_SECTION_GROUPS.map((group) => ({
    ...group,
    sections: settingsSections.filter((section) => section.groupId === group.id),
  })).filter((group) => group.sections.length > 0);

  return { settingsSectionGroups, settingsSections };
}

export function resolveSettingsSectionForPlatform(
  section: SettingsSectionId,
  visibleSections: ReadonlyArray<Pick<SettingsSectionDefinition, "id">>,
  fallbackSection: SettingsSectionId = "general",
): SettingsSectionId {
  if (visibleSections.some((candidate) => candidate.id === section)) return section;
  if (visibleSections.some((candidate) => candidate.id === fallbackSection)) {
    return fallbackSection;
  }
  return visibleSections[0]?.id ?? "general";
}

export type { SettingsSectionId };
