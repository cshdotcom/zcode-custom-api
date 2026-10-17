/**
 * 工作台轻量增强脚本（/platform/inject.js）：
 * - 在 ZCode Web SPA 运行时注入一个浮动「分享」按钮，点击打开分享中心新标签页；
 * - 平台侧功能全部自包含，不修改 SPA 源码与构建产物（index.html 注入一行 <script>）。
 */

export const PLATFORM_INJECT_JS = `(() => {
  if (window.__zcodePlatformInject) return;
  window.__zcodePlatformInject = true;
  const mount = () => {
    if (document.getElementById("zcode-platform-share-btn")) return;
    const btn = document.createElement("button");
    btn.id = "zcode-platform-share-btn";
    btn.textContent = "分享";
    btn.title = "分享当前对话 / 任务 / 项目（平台分享中心）";
    btn.setAttribute("style", [
      "position:fixed", "right:18px", "bottom:18px", "z-index:99999",
      "padding:8px 16px", "border-radius:999px", "border:1px solid #30363d",
      "background:#1f6feb", "color:#fff", "font-size:13px", "cursor:pointer",
      "box-shadow:0 4px 16px rgba(0,0,0,.45)", "font-family:inherit",
    ].join(";"));
    btn.addEventListener("click", () => window.open("/platform/shares", "_blank"));
    document.body.appendChild(btn);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();`;
