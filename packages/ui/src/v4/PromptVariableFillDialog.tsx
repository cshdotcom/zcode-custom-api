import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/**
 * 平台提示词变量填写弹窗（OpenWebUI InputVariablesModal 对应）：
 * 提示词含 `{{变量}}` 占位符时，斜杠命令选中后先收集变量值再展开进输入框。
 */
export function PromptVariableFillDialog({
  request,
  onConfirm,
  onCancel,
}: {
  request: {
    command: string;
    title: string;
    content: string;
    variables: string[];
  } | null;
  onConfirm: (expandedText: string) => void;
  onCancel: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues({});
  }, [request]);

  if (!request) return null;

  const handleSubmit = (): void => {
    const expanded = request.content.replace(
      /\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g,
      (whole: string, name: string) => {
        const value = values[name];
        return value !== undefined && value !== "" ? value : whole;
      },
    );
    onConfirm(expanded);
  };

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) onCancel();
    }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {request.title}
            {request.command ? <code className="ml-2 rounded bg-surface px-1.5 py-0.5 font-mono text-ui-xs text-foreground-subtle">/{request.command}</code> : null}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "platform.promptVariables.description" })}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {request.variables.map((variable) => (
            <div key={variable} className="space-y-1">
              <label className="font-mono text-ui-xs font-medium text-foreground">
                {`{{${variable}}}`}
              </label>
              <Textarea
                rows={2}
                autoFocus={request.variables[0] === variable}
                value={values[variable] ?? ""}
                onChange={(event) =>
                  setValues((previous) => ({ ...previous, [variable]: event.target.value }))
                }
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    handleSubmit();
                  }
                }}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
          <Button size="sm" onClick={handleSubmit}>
            {intl.formatMessage({ id: "platform.promptVariables.confirm" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
