"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { activeRunsQueryKeys } from "@/lib/services/chat/active-runs";
import { chatQueryKeys } from "@/lib/services/chat/queries";
import {
  liveUpdatesUrl,
  parseLiveMessage,
  reconnectDelayMs,
  type LiveMessage,
  type RunProgressMessage,
} from "@/lib/services/live/live-messages";
import { pinQueryKeys } from "@/lib/services/pins/queries";
import { projectQueryKeys } from "@/lib/services/project/queries";

type RunProgressListener = (message: RunProgressMessage) => void;

type LiveUpdatesContextValue = {
  /** True while the socket is open; consumers fall back to polling otherwise. */
  connected: boolean;
  subscribeRunProgress: (listener: RunProgressListener) => () => void;
};

const LiveUpdatesContext = createContext<LiveUpdatesContextValue | null>(null);

/** One query invalidation. `exact` limits it to that key, so a chat detail
 *  refetch leaves the messages subquery to the chat stream that owns it. */
export type Invalidation = { queryKey: ReadonlyArray<string>; exact: boolean };

const prefix = (queryKey: ReadonlyArray<string>): Invalidation => ({
  queryKey,
  exact: false,
});

/** Every owner-level list a missed message could have changed. */
const OWNER_LISTS: ReadonlyArray<Invalidation> = [
  prefix(chatQueryKeys.lists()),
  prefix(pinQueryKeys.list()),
  prefix(projectQueryKeys.lists()),
  // `all` also covers every tracked run's status query: a terminal status
  // lost in a listener gap must still reach the completion handling.
  prefix(activeRunsQueryKeys.all),
];

/** Invalidations a message implies. Run progress is handled by subscribers. */
export function invalidationsFor(
  message: LiveMessage,
): ReadonlyArray<Invalidation> {
  switch (message.type) {
    case "chat.changed":
      return [
        prefix(chatQueryKeys.lists()),
        { queryKey: chatQueryKeys.detail(message.chatId), exact: true },
      ];
    case "project.changed":
      return [prefix(projectQueryKeys.lists()), prefix(chatQueryKeys.lists())];
    case "pin.changed":
      return [prefix(pinQueryKeys.list())];
    case "resync":
      return OWNER_LISTS;
    case "run.progress":
      return [];
  }
}

/**
 * Batches invalidations per tick: one assistant turn produces several
 * `chat.changed` messages for the same chat, and each would otherwise trigger
 * its own list refetch.
 */
function useBatchedInvalidation(queryClient: QueryClient) {
  const pending = useRef(new Map<string, Invalidation>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  return useCallback(
    (invalidations: ReadonlyArray<Invalidation>) => {
      for (const invalidation of invalidations) {
        pending.current.set(JSON.stringify(invalidation), invalidation);
      }
      if (timer.current || pending.current.size === 0) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        const batch = [...pending.current.values()];
        pending.current.clear();
        for (const invalidation of batch) {
          void queryClient.invalidateQueries(invalidation);
        }
      }, 50);
    },
    [queryClient],
  );
}

/**
 * Holds one owner-scoped WebSocket to the API and turns its messages into
 * TanStack Query invalidations. Reconnects with jittered backoff; on every
 * (re)connect it invalidates the owner lists, since anything sent while it
 * was disconnected is lost.
 */
export function LiveUpdatesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const invalidate = useBatchedInvalidation(queryClient);
  const listeners = useRef(new Set<RunProgressListener>());
  const connected = useLiveSocket(invalidate, listeners);

  const subscribeRunProgress = useCallback((listener: RunProgressListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo(
    () => ({ connected, subscribeRunProgress }),
    [connected, subscribeRunProgress],
  );

  return (
    <LiveUpdatesContext.Provider value={value}>
      {children}
    </LiveUpdatesContext.Provider>
  );
}

/** Route one frame: run progress to subscribers, everything else to the
 *  batched invalidation. Malformed and unknown frames are dropped. */
function dispatchLiveMessage(
  message: LiveMessage | undefined,
  invalidate: (invalidations: ReadonlyArray<Invalidation>) => void,
  listeners: ReadonlySet<RunProgressListener>,
): void {
  if (!message) return;
  if (message.type === "run.progress") {
    for (const listener of listeners) listener(message);
    return;
  }
  invalidate(invalidationsFor(message));
}

/** Owns the socket lifecycle; returns whether it is currently open. */
function useLiveSocket(
  invalidate: (invalidations: ReadonlyArray<Invalidation>) => void,
  listeners: MutableRefObject<Set<RunProgressListener>>,
): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const open = () => {
      socket = new WebSocket(liveUpdatesUrl());
      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        invalidate(OWNER_LISTS);
      };
      socket.onmessage = (event: MessageEvent<unknown>) =>
        dispatchLiveMessage(
          parseLiveMessage(event.data),
          invalidate,
          listeners.current,
        );
      socket.onclose = () => {
        setConnected(false);
        if (stopped) return;
        retry = setTimeout(open, reconnectDelayMs(attempt));
        attempt += 1;
      };
    };

    open();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [invalidate, listeners]);

  return connected;
}

/** The live connection, or null when no provider is mounted (tests, stories). */
export function useOptionalLiveUpdates(): LiveUpdatesContextValue | null {
  return useContext(LiveUpdatesContext);
}
