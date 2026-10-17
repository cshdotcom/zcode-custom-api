import {
  BUILTIN_PROVIDER_TEMPLATE_IDS,
  type AppSettings,
  type Locale,
  type ProviderFamilyDomain,
} from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/services";
import { encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";

export type ApiKeyProviderChoice = "zai" | "bigmodel" | "custom";

export function resolveLoginApiKeyDefaultProvider(locale: Locale): ApiKeyProviderChoice {
  return locale === "zh-CN" ? "bigmodel" : "zai";
}

export function resolveLoginApiKeyTemplateId(
  choice: Exclude<ApiKeyProviderChoice, "custom">,
): "zai-api" | "bigmodel-api" {
  return choice === "zai"
    ? BUILTIN_PROVIDER_TEMPLATE_IDS.zai
    : BUILTIN_PROVIDER_TEMPLATE_IDS.bigmodel;
}

export function resolveLoginApiKeyProviderLabel(choice: ApiKeyProviderChoice): string {
  // Welcome Screen API Key 错误提示需要使用 BigModel 品牌固定写法。
  if (choice === "custom") {
    return "Custom API";
  }
  return choice === "zai" ? "Z.ai" : "BigModel";
}

/**
 * 解析欢迎页自定义 API 表单里的模型 ID 列表。
 * 支持英文逗号、中文逗号、空白（含换行）分隔，去重并丢弃空片段。
 */
export function parseLoginCustomModelIds(raw: string): string[] {
  const seen = new Set<string>();
  for (const token of raw.split(/[,，\s]+/u)) {
    const modelId = token.trim();
    if (modelId.length === 0) {
      continue;
    }
    seen.add(modelId);
  }
  return [...seen];
}

export function resolveLoginApiKeyProviderFamilyDomain(
  choice: Exclude<ApiKeyProviderChoice, "custom">,
): ProviderFamilyDomain {
  return choice;
}

export function buildLoginApiKeySkipSettings(
  choice: Exclude<ApiKeyProviderChoice, "custom">,
  now: number,
): Pick<
  AppSettings,
  "providerFamilyDomain" | "providerFamilyDomainUpdatedAt" | "providerFamilyDomainMigrated"
> {
  return {
    providerFamilyDomain: resolveLoginApiKeyProviderFamilyDomain(choice),
    providerFamilyDomainUpdatedAt: now,
    providerFamilyDomainMigrated: true,
  };
}

export function shouldShowLoginApiKeyLink(
  apiKeyValue: string,
  apiKeyUrl: string | undefined,
): boolean {
  return Boolean(apiKeyUrl) && apiKeyValue.trim().length === 0;
}

export function buildLoginApiKeyDefaultModelPreferenceFromSelection(
  view: ModelSelectionView,
  providerId: string,
): string | null {
  const firstModel = view.providers.find((provider) => provider.providerId === providerId)
    ?.models[0]?.modelId;
  return firstModel ? encodeCustomModelValue(providerId, firstModel) : null;
}

export function resolveHydratedLoginApiKeyValue({
  savedApiKey,
  userEdited,
}: {
  savedApiKey: string;
  userEdited: boolean;
}): string | null {
  if (userEdited) {
    return null;
  }
  return savedApiKey.trim();
}
