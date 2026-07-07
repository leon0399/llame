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
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { toast } from "@workspace/ui/components/sonner";

import {
  activeRunsQueryKeys,
  activeRunsToTrackArgs,
  fetchActiveRuns,
  fetchRun,
  type Run,
} from "@/lib/services/chat/active-runs";
import { chatQueryKeys } from "@/lib/services/chat/queries";
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
  const queryClient = useQueryClient();
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
  // newly observed. That alone isn't sufficient, though: `data` is returned
  // synchronously from whatever's already cached (React Query's normal
  // stale-while-revalidate contract) BEFORE the forced refetch resolves — if
  // this provider previously mounted, unmounted (e.g. navigating out of the
  // (chat) route group), and remounted within the query's gcTime, `data`
  // could briefly be THAT OLDER mount's snapshot. Re-tracking a run from it
  // is otherwise idempotent, but this provider's own `handledRunIds`/
  // `completedChats` are fresh per-mount state with no memory of a
  // notification already fired for that run in the earlier mount — so acting
  // on the stale snapshot could double-notify. `isFetchedAfterMount` gates on
  // THIS mount's own fetch having actually resolved, not a leftover cache hit.
  const { data: rehydratedRuns, isFetchedAfterMount } = useQuery({
    queryKey: activeRunsQueryKeys.list(),
    queryFn: fetchActiveRuns,
    staleTime: 0,
    refetchOnMount: "always",
  });
  useEffect(() => {
    if (!isFetchedAfterMount || !rehydratedRuns) return;
    for (const [runId, chatId, title] of activeRunsToTrackArgs(
      rehydratedRuns,
    )) {
      trackRun(runId, chatId, title);
    }
  }, [isFetchedAfterMount, rehydratedRuns, trackRun]);

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
      // Unconditional, regardless of the toast/badge decision above: a run
      // reaching terminal can complete without the client ever seeing it live
      // (e.g. a transient stream error kept the run tracked instead of
      // untracking it — #132 review — so no further onFinish ever fires for
      // it). Invalidating here means the chat's content matches the true
      // server state whether the tab is open on it right now or the next
      // time it's opened; cheap when nobody's watching (React Query only
      // marks it stale, no refetch without a mounted observer).
      void queryClient.invalidateQueries({
        queryKey: chatQueryKeys.messages(meta.chatId),
      });
      if (res.badge) {
        setCompletedChats((prev) => {
          if (prev.has(meta.chatId)) return prev; // no-op update, no re-render
          return new Set(prev).add(meta.chatId);
        });
      }
      if (res.toast) notify(res.toast, meta.chatId, meta.title);
    });
  }, [activeEntries, runQueries, drop, queryClient]);

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
