"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { usePathname, useRouter } from "next/navigation";

import { toast } from "@workspace/ui/components/sonner";

import { fetchRun } from "@/lib/services/chat/runs";
import {
  isTerminalRunStatus,
  resolveTerminalRun,
} from "@/lib/services/chat/run-notifications";

const POLL_MS = 4000;

type TrackedRun = { chatId: string; title: string };

type ActiveRunsContextValue = {
  trackRun: (runId: string, chatId: string, title: string) => void;
  /** Drop this chat's tracked run(s) when the user WATCHED it finish (useChat
   *  onFinish/onError), so the poll can't later fire a stale "reply ready" for
   *  something they already saw after they navigate away. */
  untrackChat: (chatId: string) => void;
  /** Chats with an unseen background completion (drives the sidebar badge). */
  completedChats: ReadonlySet<string>;
  markChatSeen: (chatId: string) => void;
};

const ActiveRunsContext = createContext<ActiveRunsContextValue | null>(null);

/** Fire a desktop notification — ONLY in a secure context where it's granted
 *  and the tab is hidden (redundant when visible). No-op otherwise. */
function desktopNotify(title: string, body: string, onClick: () => void) {
  if (
    typeof window === "undefined" ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted" ||
    !document.hidden
  ) {
    return;
  }
  try {
    const n = new Notification(title, { body });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    // Some browsers throw for non-persistent notifications; the toast covers it.
  }
}

export function ActiveRunsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = useState<Map<string, TrackedRun>>(new Map());
  const [completedChats, setCompletedChats] = useState<Set<string>>(new Set());

  // Refs so the mount-once poll reads live state without restarting the timer.
  const activeRef = useRef(active);
  activeRef.current = active;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const routerRef = useRef(router);
  routerRef.current = router;

  const drop = useCallback((runId: string) => {
    setActive((prev) => {
      if (!prev.has(runId)) return prev;
      const next = new Map(prev);
      next.delete(runId);
      return next;
    });
  }, []);

  const trackRun = useCallback(
    (runId: string, chatId: string, title: string) => {
      setActive((prev) => {
        if (prev.get(runId)?.chatId === chatId) return prev; // idempotent
        return new Map(prev).set(runId, { chatId, title });
      });
    },
    [],
  );

  const untrackChat = useCallback((chatId: string) => {
    setActive((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [runId, meta] of prev) {
        if (meta.chatId === chatId) {
          next.delete(runId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const markChatSeen = useCallback((chatId: string) => {
    setCompletedChats((prev) => {
      if (!prev.has(chatId)) return prev;
      const next = new Set(prev);
      next.delete(chatId);
      return next;
    });
  }, []);

  useEffect(() => {
    const notify = (
      kind: "completed" | "failed",
      chatId: string,
      title: string,
    ) => {
      const open = () => routerRef.current.push(`/chat/${chatId}`);
      // Offer to enable desktop alerts (user gesture) only when unset.
      const canEnable =
        typeof Notification !== "undefined" &&
        Notification.permission === "default";
      const opts = {
        action: { label: "View", onClick: open },
        ...(canEnable
          ? {
              cancel: {
                label: "Enable alerts",
                onClick: () =>
                  void Notification.requestPermission().then((perm) => {
                    if (perm === "granted") {
                      toast.success("Desktop alerts enabled");
                    }
                  }),
              },
            }
          : {}),
      };
      if (kind === "failed") {
        toast.error(`Run failed — ${title}`, opts);
      } else {
        toast(`Reply ready — ${title}`, opts);
      }
      desktopNotify(
        kind === "failed" ? "Run failed" : "Reply ready",
        title,
        open,
      );
    };

    const tick = async () => {
      const entries = [...activeRef.current.entries()];
      if (entries.length === 0) return;
      await Promise.all(
        entries.map(async ([runId, meta]) => {
          let run;
          try {
            run = await fetchRun(runId);
          } catch {
            return; // transient — retry next tick
          }
          if (run === null) {
            drop(runId); // 404: gone (e.g. chat deleted)
            return;
          }
          if (!isTerminalRunStatus(run.status)) return;
          const viewing = pathnameRef.current === `/chat/${meta.chatId}`;
          const res = resolveTerminalRun(run.status, {
            viewingThisChat: viewing,
            tabHidden:
              typeof document !== "undefined" ? document.hidden : false,
          });
          drop(runId);
          if (res.badge) {
            setCompletedChats((prev) => new Set(prev).add(meta.chatId));
          }
          if (res.toast) notify(res.toast, meta.chatId, meta.title);
        }),
      );
    };

    const id = setInterval(() => void tick(), POLL_MS);
    return () => clearInterval(id);
  }, [drop]);

  return (
    <ActiveRunsContext.Provider
      value={{ trackRun, untrackChat, completedChats, markChatSeen }}
    >
      {children}
    </ActiveRunsContext.Provider>
  );
}

export function useActiveRuns(): ActiveRunsContextValue {
  const ctx = useContext(ActiveRunsContext);
  if (!ctx) {
    throw new Error("useActiveRuns must be used within ActiveRunsProvider");
  }
  return ctx;
}
