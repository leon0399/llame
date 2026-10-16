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

import { handleUnauthorizedResponse } from "@/lib/api/fetch";
import {
  applyLiveMessage,
  invalidateOwnerLists,
} from "@/lib/services/live/apply-live-message";
import {
  CLOSE_SESSION_ENDED,
  liveUpdatesUrl,
  parseLiveMessage,
  reconnectDelayMs,
  type LiveMessage,
  type RunMessage,
} from "@/lib/services/live/live-messages";

type RunMessageListener = (message: RunMessage) => void;

type LiveUpdatesContextValue = {
  /** True while the socket is open; consumers fall back to polling otherwise. */
  connected: boolean;
  subscribeRunMessages: (listener: RunMessageListener) => () => void;
};

const LiveUpdatesContext = createContext<LiveUpdatesContextValue | null>(null);

/**
 * Holds one owner-scoped WebSocket to the API (protocol:
 * `apps/api/asyncapi.yaml`). Record messages update the TanStack Query caches
 * in place; run messages go to subscribers (the active-runs provider).
 * Reconnects with jittered backoff; on every (re)connect it refetches the
 * owner lists, since messages sent while it was disconnected are lost.
 * When the server ends the session (close code 4401) it stops and sends the
 * user to sign in, as an HTTP 401 does.
 */
export function LiveUpdatesProvider({
  children,
  onSessionEnded = handleUnauthorizedResponse,
}: {
  children: React.ReactNode;
  onSessionEnded?: () => void;
}) {
  const queryClient = useQueryClient();
  const listeners = useRef(new Set<RunMessageListener>());
  const connected = useLiveSocket(queryClient, listeners, onSessionEnded);

  const subscribeRunMessages = useCallback((listener: RunMessageListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo(
    () => ({ connected, subscribeRunMessages }),
    [connected, subscribeRunMessages],
  );

  return (
    <LiveUpdatesContext.Provider value={value}>
      {children}
    </LiveUpdatesContext.Provider>
  );
}

/** Route one parsed frame: run messages to subscribers, records to the caches. */
export function dispatchLiveMessage(
  message: LiveMessage | undefined,
  queryClient: QueryClient,
  listeners: ReadonlySet<RunMessageListener>,
): void {
  if (!message) return;
  if (message.type === "run.updated" || message.type === "run.progress") {
    for (const listener of listeners) listener(message);
    return;
  }
  applyLiveMessage(queryClient, message);
}

type LiveSocketHandlers = {
  onOpen: () => void;
  onMessage: (message: LiveMessage | undefined) => void;
  onClose: () => void;
  onSessionEnded: () => void;
};

/**
 * Opens the live socket and reopens it with jittered backoff after any close
 * except a session end, which stops the loop. Returns the teardown.
 */
function connectLiveSocket(handlers: LiveSocketHandlers): () => void {
  let socket: WebSocket | null = null;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const open = () => {
    socket = new WebSocket(liveUpdatesUrl());
    socket.onopen = () => {
      attempt = 0;
      handlers.onOpen();
    };
    socket.onmessage = (event: MessageEvent<unknown>) =>
      handlers.onMessage(parseLiveMessage(event.data));
    socket.onclose = (event: CloseEvent) => {
      handlers.onClose();
      if (stopped) return;
      if (event.code === CLOSE_SESSION_ENDED) {
        stopped = true;
        handlers.onSessionEnded();
        return;
      }
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
}

/** Owns the socket lifecycle; returns whether it is currently open. */
function useLiveSocket(
  queryClient: QueryClient,
  listeners: MutableRefObject<Set<RunMessageListener>>,
  onSessionEnded: () => void,
): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(
    () =>
      connectLiveSocket({
        onOpen: () => {
          setConnected(true);
          invalidateOwnerLists(queryClient);
        },
        onMessage: (message) =>
          dispatchLiveMessage(message, queryClient, listeners.current),
        onClose: () => setConnected(false),
        onSessionEnded,
      }),
    [queryClient, listeners, onSessionEnded],
  );

  return connected;
}

/** The live connection, or null when no provider is mounted (tests, stories). */
export function useOptionalLiveUpdates(): LiveUpdatesContextValue | null {
  return useContext(LiveUpdatesContext);
}
