"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { usePathname, useRouter } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";

import { toast } from "@workspace/ui/components/sonner";

import {
  activeRunsQueryKeys,
  activeRunsToTrackArgs,
  fetchActiveRuns,
  fetchRun,
  type Run,
} from "@/lib/services/chat/active-runs";
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
  /** Chats with a currently-tracked, not-yet-terminal run (drives the sidebar's
   *  "processing" activity indicator). */
  activeChatIds: ReadonlySet<string>;
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

  // Refs so the notify effect below reads live pathname/router without
  // needing them in its dependency array.
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

  // Re-hydrate in-flight runs on mount — a page reload wipes the in-memory
  // tracker, so "send a message, walk away, get notified" would otherwise break
  // on refresh. staleTime: 0 + refetchOnMount: "always" (the useMe() precedent,
  // apps/web/AGENTS.md) force a FRESH server read every time this query is
  // newly observed — a frozen/stale cached snapshot replaying on a later mount
  // would re-track already-completed runs and double-notify, so this can never
  // trust a cache entry older than "right now". trackRun is idempotent, so a
  // run already tracked this session isn't duplicated.
  const { data: rehydratedRuns } = useQuery({
    queryKey: activeRunsQueryKeys.list(),
    queryFn: fetchActiveRuns,
    staleTime: 0,
    refetchOnMount: "always",
  });
  useEffect(() => {
    if (!rehydratedRuns) return;
    for (const [runId, chatId, title] of activeRunsToTrackArgs(
      rehydratedRuns,
    )) {
      trackRun(runId, chatId, title);
    }
  }, [rehydratedRuns, trackRun]);

  // Poll every tracked run until it reaches a terminal status. One query per
  // run (queued/dropped as `active` changes), each on its own POLL_MS
  // interval that self-stops once its data is terminal (or the run is gone) —
  // `refetchIntervalInBackground: true` is required here (not React Query's
  // default): the whole point of this feature is noticing completion while
  // the tab is backgrounded, so polling must NOT pause on blur/hidden the way
  // refetchInterval does by default.
  const activeEntries = useMemo(() => [...active.entries()], [active]);
  const runQueries = useQueries({
    queries: activeEntries.map(([runId]) => ({
      queryKey: activeRunsQueryKeys.run(runId),
      queryFn: () => fetchRun(runId),
      staleTime: 0,
      refetchInterval: (query: { state: { data?: Run | null } }) => {
        const data = query.state.data;
        if (data === undefined) return POLL_MS; // no result yet — keep polling
        if (data === null) return false; // 404: gone, nothing left to poll
        return isTerminalRunStatus(data.status) ? false : POLL_MS;
      },
      refetchIntervalInBackground: true,
    })),
  });

  // Guards against firing a completion notification more than once for the
  // same run: `runQueries` is a NEW array every render (React Query's own
  // contract for useQueries), so this effect can re-run before `drop()`'s
  // state update has removed the run from `active` — without this ref, that
  // window could double-notify the same terminal result.
  const handledRunIds = useRef(new Set<string>());

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

    activeEntries.forEach(([runId, meta], index) => {
      if (handledRunIds.current.has(runId)) return;
      const run = runQueries[index]?.data;
      if (run === undefined) return; // still loading / errored — keep waiting
      if (run === null) {
        handledRunIds.current.add(runId);
        drop(runId); // 404: gone (e.g. chat deleted)
        return;
      }
      if (!isTerminalRunStatus(run.status)) return;
      handledRunIds.current.add(runId);
      const viewing = pathnameRef.current === `/chat/${meta.chatId}`;
      const res = resolveTerminalRun(run.status, {
        viewingThisChat: viewing,
        tabHidden: typeof document !== "undefined" ? document.hidden : false,
      });
      drop(runId);
      if (res.badge) {
        setCompletedChats((prev) => new Set(prev).add(meta.chatId));
      }
      if (res.toast) notify(res.toast, meta.chatId, meta.title);
    });
  }, [activeEntries, runQueries, drop]);

  const activeChatIds = useMemo(
    () => new Set(activeEntries.map(([, meta]) => meta.chatId)),
    [activeEntries],
  );

  const value = useMemo(
    () => ({
      trackRun,
      untrackChat,
      completedChats,
      markChatSeen,
      activeChatIds,
    }),
    [trackRun, untrackChat, completedChats, markChatSeen, activeChatIds],
  );

  return (
    <ActiveRunsContext.Provider value={value}>
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
