import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { usePlatformAnnouncement } from "./platformUserStore.js";

/**
 * 工作台公告横幅（深度融合，零侵入 Root 布局）：
 * 管理员在「设置 → 平台管理 → 系统」开启并维护公告后，登录用户进入工作台时
 * 顶部悬浮展示；同一公告内容（按 title+body 摘要）关闭后不再重复出现。
 */
const DISMISS_KEY_PREFIX = "zcode.platform.announcement.dismissed.";

function dismissKey(title: string, body: string): string {
  const raw = `${title}\n${body}`;
  let hash = 5381;
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) + hash + raw.charCodeAt(index)) | 0;
  }
  return `${DISMISS_KEY_PREFIX}${(hash >>> 0).toString(36)}`;
}

export function PlatformAnnouncementBanner(): null | React.ReactElement {
  const announcement = usePlatformAnnouncement();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!announcement) return;
    try {
      setDismissed(window.localStorage.getItem(dismissKey(announcement.title, announcement.body)) === "1");
    } catch {
      setDismissed(false);
    }
  }, [announcement]);

  if (!announcement || dismissed) return null;

  return (
    <div
      data-testid="platform-announcement-banner"
      className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center px-4 pt-2"
    >
      <div className="pointer-events-auto flex max-w-2xl items-start gap-3 rounded-xl border border-border bg-card px-4 py-2.5 shadow-lg">
        <div className="min-w-0">
          {announcement.title ? (
            <div className="text-ui-sm font-semibold text-foreground">{announcement.title}</div>
          ) : null}
          {announcement.body ? (
            <div className="whitespace-pre-wrap text-ui-xs text-foreground-subtle">{announcement.body}</div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss announcement"
          className="-mr-1 -mt-0.5 rounded-md p-1 text-foreground-subtle transition-colors hover:bg-surface hover:text-foreground"
          onClick={() => {
            try {
              window.localStorage.setItem(dismissKey(announcement.title, announcement.body), "1");
            } catch {
              // localStorage 不可用时仅本次会话内关闭。
            }
            setDismissed(true);
          }}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
