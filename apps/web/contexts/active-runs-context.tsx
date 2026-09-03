"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import { useRouter } from "next/navigation";
import {
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

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
type ActiveEntry = readonly [string, TrackedRun];
type ToastOptions = NonNullable<Parameters<typeof toast>[1]>;

type ActiveRunsContextValue = {
  trackRun: (runId: string, chatId: string, title: string) => void;
  /** Drop this chat's tracked run(s) when the user WATCHED it finish (useChat
   *  onFinish/onError), so the poll can't later fire a stale "reply ready" for
   *  something they already saw after they navigate away. */
  untrackChat: (chatId: string) => void;
  /** Register the chat currently rendered in the foreground. The mounted
   *  ChatPage is authoritative even while a new chat still has the `/` URL. */
  registerViewedChat: (chatId: string) => () => void;
  /** Chats with an unseen background completion (drives the sidebar badge). */
  completedChats: ReadonlySet<string>;
  markChatSeen: (chatId: string) => void;
  /** Chats with a currently-tracked, not-yet-terminal run (drives the sidebar's
   *  "processing" activity indicator). */
  activeChatIds: ReadonlySet<string>;
};

const ActiveRunsContext = createContext<ActiveRunsContextValue | null>(null);

function hasWindow(): boolean {
  return "window" in globalThis;
}

function hasNotificationApi(): boolean {
  return "Notification" in globalThis;
}

/** Fire a desktop notification — ONLY in a secure context where it's granted
 *  and the tab is hidden (redundant when visible). No-op otherwise. */
function desktopNotify(title: string, body: string, onClick: () => void) {
  if (
    !hasWindow() ||
    !hasNotificationApi() ||
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

function showRunNotification(
  kind: "completed" | "failed",
  title: string,
  handlers: { onView: () => void },
): void {
  // Offer to enable desktop alerts (user gesture) only when unset.
  const canEnable =
    hasNotificationApi() && Notification.permission === "default";
  const opts: ToastOptions = {
    action: { label: "View", onClick: handlers.onView },
  };
  if (canEnable) {
    opts.cancel = {
      label: "Enable alerts",
      onClick: () =>
        void Notification.requestPermission().then((perm) => {
          if (perm === "granted") {
            toast.success("Desktop alerts enabled");
          }
        }),
    };
  }
  if (kind === "failed") {
    toast.error(`Run failed — ${title}`, opts);
  } else {
    toast(`Reply ready — ${title}`, opts);
  }
  desktopNotify(
    kind === "failed" ? "Run failed" : "Reply ready",
    title,
    handlers.onView,
  );
}

function dropRun(
  prev: Map<string, TrackedRun>,
  runId: string,
): Map<string, TrackedRun> {
  if (!prev.has(runId)) return prev;
  const next = new Map(prev);
  next.delete(runId);
  return next;
}

function addTrackedRun(
  prev: Map<string, TrackedRun>,
  runId: string,
  chatId: string,
  title: string,
): Map<string, TrackedRun> {
  if (prev.get(runId)?.chatId === chatId) return prev; // idempotent
  return new Map(prev).set(runId, { chatId, title });
}

function removeChatRuns(
  prev: Map<string, TrackedRun>,
  chatId: string,
): Map<string, TrackedRun> {
  let changed = false;
  const next = new Map(prev);
  for (const [runId, meta] of prev) {
    if (meta.chatId === chatId) {
      next.delete(runId);
      changed = true;
    }
  }
  return changed ? next : prev;
}

function clearSeenChat(prev: Set<string>, chatId: string): Set<string> {
  if (!prev.has(chatId)) return prev;
  const next = new Set(prev);
  next.delete(chatId);
  return next;
}

/** Tracked-run state plus its mutators — the part of the provider that owns
 *  `active`/`completedChats` and needs no knowledge of polling or rehydration. */
function useTrackedRuns() {
  const [active, setActive] = useState<Map<string, TrackedRun>>(new Map());
  const [completedChats, setCompletedChats] = useState<Set<string>>(new Set());
  const viewedChatIdRef = useRef<string | null>(null);

  const registerViewedChat = useCallback((chatId: string) => {
    viewedChatIdRef.current = chatId;
    return () => {
      if (viewedChatIdRef.current === chatId) viewedChatIdRef.current = null;
    };
  }, []);

  const drop = useCallback(
    (runId: string) => setActive((prev) => dropRun(prev, runId)),
    [],
  );
  const trackRun = useCallback(
    (runId: string, chatId: string, title: string) =>
      setActive((prev) => addTrackedRun(prev, runId, chatId, title)),
    [],
  );
  const untrackChat = useCallback(
    (chatId: string) => setActive((prev) => removeChatRuns(prev, chatId)),
    [],
  );
  const markChatSeen = useCallback(
    (chatId: string) =>
      setCompletedChats((prev) => clearSeenChat(prev, chatId)),
    [],
  );

  return {
    active,
    completedChats,
    setCompletedChats,
    viewedChatIdRef,
    registerViewedChat,
    trackRun,
    untrackChat,
    markChatSeen,
    drop,
  };
}

/**
 * Re-hydrate in-flight runs on mount — a page reload wipes the in-memory
 * tracker, so "send a message, walk away, get notified" would otherwise break
 * on refresh. staleTime: 0 + refetchOnMount: "always" (the useMe() precedent,
 * apps/web/AGENTS.md) force a FRESH server read every time this query is
 * newly observed. That alone isn't sufficient, though: `data` is returned
 * synchronously from whatever's already cached (React Query's normal
 * stale-while-revalidate contract) BEFORE the forced refetch resolves — if
 * this provider previously mounted, unmounted (e.g. navigating out of the
 * (chat) route group), and remounted within the query's gcTime, `data`
 * could briefly be THAT OLDER mount's snapshot. Re-tracking a run from it
 * is otherwise idempotent, but this provider's own `handledRunIds`/
 * `completedChats` are fresh per-mount state with no memory of a
 * notification already fired for that run in the earlier mount — so acting
 * on the stale snapshot could double-notify. `isFetchedAfterMount` gates on
 * THIS mount's own fetch having actually resolved, not a leftover cache hit.
 */
function useRehydrateActiveRuns(
  trackRun: (runId: string, chatId: string, title: string) => void,
): void {
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
}

// Poll every tracked run until it reaches a terminal status. One query per
// run (queued/dropped as `active` changes), each on its own POLL_MS
// interval that self-stops once its data is terminal (or the run is gone) —
// `refetchIntervalInBackground: true` is required here (not React Query's
// default): the whole point of this feature is noticing completion while
// the tab is backgrounded, so polling must NOT pause on blur/hidden the way
// refetchInterval does by default.
function useActiveRunQueries(activeEntries: ReadonlyArray<ActiveEntry>) {
  return useQueries({
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
}

type TerminalRunHandlerDeps = {
  handledRunIds: MutableRefObject<Set<string>>;
  drop: (runId: string) => void;
  queryClient: QueryClient;
  setCompletedChats: Dispatch<SetStateAction<Set<string>>>;
  viewedChatIdRef: MutableRefObject<string | null>;
  routerRef: MutableRefObject<ReturnType<typeof useRouter>>;
};

function handleTerminalRun(
  runId: string,
  meta: TrackedRun,
  run: Run | null | undefined,
  deps: TerminalRunHandlerDeps,
): void {
  const {
    handledRunIds,
    drop,
    queryClient,
    setCompletedChats,
    viewedChatIdRef,
    routerRef,
  } = deps;
  if (handledRunIds.current.has(runId)) return;
  if (run === undefined) return; // still loading / errored — keep waiting
  if (run === null) {
    handledRunIds.current.add(runId);
    drop(runId); // 404: gone (e.g. chat deleted)
    return;
  }
  if (!isTerminalRunStatus(run.status)) return;
  handledRunIds.current.add(runId);
  const res = resolveTerminalRun(run.status, {
    viewingThisChat: viewedChatIdRef.current === meta.chatId,
    tabHidden: "document" in globalThis ? document.hidden : false,
  });
  drop(runId);
  // Unconditional: a run can reach terminal without the client ever seeing
  // it live (#132 review), so this keeps the chat's cache correct even when
  // nobody's watching (cheap — React Query only marks it stale here).
  void queryClient.invalidateQueries({
    queryKey: chatQueryKeys.messages(meta.chatId),
  });
  notifyTerminalRun(res, meta, setCompletedChats, routerRef);
}

function notifyTerminalRun(
  res: ReturnType<typeof resolveTerminalRun>,
  meta: TrackedRun,
  setCompletedChats: Dispatch<SetStateAction<Set<string>>>,
  routerRef: MutableRefObject<ReturnType<typeof useRouter>>,
): void {
  if (res.badge) {
    setCompletedChats((prev) =>
      prev.has(meta.chatId) ? prev : new Set(prev).add(meta.chatId),
    );
  }
  if (res.toast) {
    showRunNotification(res.toast, meta.title, {
      onView: () => routerRef.current.push(`/chat/${meta.chatId}`),
    });
  }
}

/** Polls every tracked run and fires the completion/failure toast + badge +
 *  cache-invalidation side effects once each one reaches a terminal status. */
function useRunCompletionEffects(params: {
  activeEntries: ReadonlyArray<ActiveEntry>;
  drop: (runId: string) => void;
  queryClient: QueryClient;
  viewedChatIdRef: MutableRefObject<string | null>;
  routerRef: MutableRefObject<ReturnType<typeof useRouter>>;
  setCompletedChats: Dispatch<SetStateAction<Set<string>>>;
}): void {
  const {
    activeEntries,
    drop,
    queryClient,
    viewedChatIdRef,
    routerRef,
    setCompletedChats,
  } = params;
  const runQueries = useActiveRunQueries(activeEntries);

  // Guards against firing a completion notification more than once for the
  // same run: `runQueries` is a NEW array every render (React Query's own
  // contract for useQueries), so this effect can re-run before `drop()`'s
  // state update has removed the run from `active` — without this ref, that
  // window could double-notify the same terminal result.
  const handledRunIds = useRef(new Set<string>());

  useEffect(() => {
    activeEntries.forEach(([runId, meta], index) => {
      handleTerminalRun(runId, meta, runQueries[index]?.data, {
        handledRunIds,
        drop,
        queryClient,
        setCompletedChats,
        viewedChatIdRef,
        routerRef,
      });
    });
  }, [
    activeEntries,
    runQueries,
    drop,
    queryClient,
    setCompletedChats,
    viewedChatIdRef,
    routerRef,
  ]);
}

/** Stable ref to the latest router, so effects can read it without depending
 *  on the router identity itself. */
function useRouterRef(): MutableRefObject<ReturnType<typeof useRouter>> {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  return routerRef;
}

/** The active-run entries plus the derived set of chats with an active run. */
function useActiveEntries(active: Map<string, TrackedRun>) {
  const activeEntries = useMemo(() => [...active.entries()], [active]);
  const activeChatIds = useMemo(
    () => new Set(activeEntries.map(([, meta]) => meta.chatId)),
    [activeEntries],
  );
  return { activeEntries, activeChatIds };
}

function useContextValue(params: {
  trackRun: ActiveRunsContextValue["trackRun"];
  untrackChat: ActiveRunsContextValue["untrackChat"];
  registerViewedChat: ActiveRunsContextValue["registerViewedChat"];
  completedChats: ReadonlySet<string>;
  markChatSeen: ActiveRunsContextValue["markChatSeen"];
  activeChatIds: ReadonlySet<string>;
}): ActiveRunsContextValue {
  const {
    trackRun,
    untrackChat,
    registerViewedChat,
    completedChats,
    markChatSeen,
    activeChatIds,
  } = params;
  return useMemo(
    () => ({
      trackRun,
      untrackChat,
      registerViewedChat,
      completedChats,
      markChatSeen,
      activeChatIds,
    }),
    [
      trackRun,
      untrackChat,
      registerViewedChat,
      completedChats,
      markChatSeen,
      activeChatIds,
    ],
  );
}

type ActiveRunsProviderProps = { children: React.ReactNode };

export function ActiveRunsProvider({ children }: ActiveRunsProviderProps) {
  const routerRef = useRouterRef();
  const queryClient = useQueryClient();

  const {
    active,
    completedChats,
    setCompletedChats,
    viewedChatIdRef,
    registerViewedChat,
    trackRun,
    untrackChat,
    markChatSeen,
    drop,
  } = useTrackedRuns();

  useRehydrateActiveRuns(trackRun);

  const { activeEntries, activeChatIds } = useActiveEntries(active);

  useRunCompletionEffects({
    activeEntries,
    drop,
    queryClient,
    viewedChatIdRef,
    routerRef,
    setCompletedChats,
  });

  const value = useContextValue({
    trackRun,
    untrackChat,
    registerViewedChat,
    completedChats,
    markChatSeen,
    activeChatIds,
  });

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

/**
 * Run status for components the shared shell renders under more than one
 * provider set — the pinned rail lives inside `AppSidebar`, which the admin
 * layout mounts deliberately without this provider. Absent provider means no
 * run is known to be active here, which is the truth on those routes: it is
 * the caller's cue to show nothing, not to guess.
 *
 * Anything that cannot function without run state should keep using
 * `useActiveRuns` and fail loudly instead.
 *
 * @summary run status where a provider may legitimately be absent
 */
export function useOptionalActiveRuns(): ActiveRunsContextValue | null {
  return useContext(ActiveRunsContext) ?? null;
}
