/**
 * 平台提示词模板变量工具（OpenWebUI extractInputVariables 对应的轻量版）：
 * 从 `{{变量名}}` 占位符中提取变量名列表（去重、保序），
 * 并支持把用户填写值替换回模板展开为最终文本。
 */

const VARIABLE_PATTERN = /\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g;

/** 提取模板中的变量名（保序去重）。 */
export function extractPromptTemplateVariables(template: string): string[] {
  const variables: string[] = [];
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (name && !variables.includes(name)) {
      variables.push(name);
    }
  }
  return variables;
}

/** 用填写值展开模板：未提供的变量保留原占位符，便于用户后续手动补。 */
export function expandPromptTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(VARIABLE_PATTERN, (whole, name: string) => {
    const value = values[name];
    return value !== undefined && value !== "" ? value : whole;
  });
}
