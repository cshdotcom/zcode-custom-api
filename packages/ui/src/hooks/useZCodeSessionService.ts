import type { IZCodeSessionService } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

export function useZCodeSessionService(
  workspacePath?: string,
  preferredRemoteSessionId?: string | null,
  workspaceIdentity?: string | null,
): IZCodeSessionService {
  // Rules of Hooks：两条分支的 hooks 必须无条件执行。workspacePath 在启动解析期间
  // 会从 undefined 翻转为具体路径，条件分支会让同一 fiber 的 hook 数量在两次渲染间
  // 变化，触发 areHookInputsEqual 崩溃（onboarding-dialog 静默 ErrorBoundary 捕获，
  // 控制台出现 "Cannot read properties of undefined (reading 'length')"）。
  // useWorkspaceServices 本身支持 undefined workspacePath（按本地服务解析），
  // 无条件调用后按当前参数选择结果即可。
  const localServices = useServices();
  const workspaceServices = useWorkspaceServices(
    workspacePath,
    preferredRemoteSessionId,
    workspaceIdentity,
  );
  return (workspacePath ? workspaceServices : localServices).zcodeSessionService;
}
