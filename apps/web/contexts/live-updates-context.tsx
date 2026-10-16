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

import {
  applyLiveMessage,
  invalidateOwnerLists,
} from "@/lib/services/live/apply-live-message";
import {
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
 */
export function LiveUpdatesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const listeners = useRef(new Set<RunMessageListener>());
  const connected = useLiveSocket(queryClient, listeners);

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

/** Owns the socket lifecycle; returns whether it is currently open. */
function useLiveSocket(
  queryClient: QueryClient,
  listeners: MutableRefObject<Set<RunMessageListener>>,
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
        invalidateOwnerLists(queryClient);
      };
      socket.onmessage = (event: MessageEvent<unknown>) =>
        dispatchLiveMessage(
          parseLiveMessage(event.data),
          queryClient,
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
  }, [queryClient, listeners]);

  return connected;
}

/** The live connection, or null when no provider is mounted (tests, stories). */
export function useOptionalLiveUpdates(): LiveUpdatesContextValue | null {
  return useContext(LiveUpdatesContext);
}
