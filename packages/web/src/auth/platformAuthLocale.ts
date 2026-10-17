type PlatformAuthLocale = "zh-CN" | "en-US";

/**
 * 平台登录门文案：与官方 webAuthLocale 同一套组织方式。
 * 登录门深度融合在 SPA 内，视觉完全复用官方登录卡片设计。
 */

export interface PlatformAuthPageCopy {
  brand: string;
  loginTitle: string;
  loginDescription: string;
  setupTitle: string;
  setupDescription: string;
  usernameLabel: string;
  passwordLabel: string;
  confirmPasswordLabel: string;
  inviteCodeLabel: string;
  inviteCodePlaceholder: string;
  loginAction: string;
  registerAction: string;
  setupAction: string;
  submittingAction: string;
  toRegister: string;
  toLogin: string;
  usernamePlaceholder: string;
  passwordPlaceholder: string;
  pendingTitle: string;
  logoutAction: string;
  successAction: string;
}

const PLATFORM_AUTH_COPY = {
  "zh-CN": {
    brand: "ZCode",
    loginTitle: "登录 ZCode",
    loginDescription: "登录平台账号，继续使用你的工作台、对话与项目。",
    setupTitle: "初始化管理员账号",
    setupDescription: "首次使用：创建的第一个账号将成为平台管理员。",
    usernameLabel: "用户名",
    passwordLabel: "密码",
    confirmPasswordLabel: "确认密码",
    inviteCodeLabel: "邀请码",
    inviteCodePlaceholder: "输入邀请码",
    loginAction: "登录",
    registerAction: "注册",
    setupAction: "创建管理员账号",
    submittingAction: "请稍候…",
    toRegister: "还没有账号？注册新账号",
    toLogin: "已有账号？直接登录",
    usernamePlaceholder: "用户名或邮箱",
    passwordPlaceholder: "输入密码",
    pendingTitle: "账号已创建，等待管理员审批",
    logoutAction: "退出登录",
    successAction: "继续",
  },
  "en-US": {
    brand: "ZCode",
    loginTitle: "Sign in to ZCode",
    loginDescription: "Sign in to your platform account to continue to your workspace.",
    setupTitle: "Set Up Admin Account",
    setupDescription: "First run: the first account created becomes the platform admin.",
    usernameLabel: "Username",
    passwordLabel: "Password",
    confirmPasswordLabel: "Confirm Password",
    inviteCodeLabel: "Invite Code",
    inviteCodePlaceholder: "Enter invite code",
    loginAction: "Sign In",
    registerAction: "Register",
    setupAction: "Create Admin Account",
    submittingAction: "Working…",
    toRegister: "No account yet? Register",
    toLogin: "Already have an account? Sign in",
    usernamePlaceholder: "Username or email",
    passwordPlaceholder: "Enter password",
    pendingTitle: "Account created, pending approval",
    logoutAction: "Sign Out",
    successAction: "Continue",
  },
} satisfies Record<PlatformAuthLocale, PlatformAuthPageCopy>;

function resolvePlatformAuthLocale(language?: string): PlatformAuthLocale {
  const candidate =
    language ??
    document.documentElement.lang ??
    navigator.language ??
    navigator.languages?.[0] ??
    "";
  return candidate.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function getPlatformAuthCopy(locale?: string): PlatformAuthPageCopy {
  return PLATFORM_AUTH_COPY[resolvePlatformAuthLocale(locale)];
}
