import { useCallback, useEffect, useState } from "react";

const MESSAGE_TARGET_HASH = /^#msg-([1-9]\d*)$/;

type MessageTargetState =
  | { chatId: string; resolved: false }
  | {
      chatId: string;
      resolved: true;
      targetSeq: number | null;
      // The wall-clock time of the last `resolveLatest()` — i.e. when a
      // target-window send finished and the view was returned to latest. `null`
      // on any plain navigation (no target send finished). Consumed by the
      // live view's last-turn restore (chat-page.tsx) to tell a pre-send SSR
      // history snapshot — cache data dated before this timestamp — apart from
      // the post-send refetch that replaces it (#1084).
      lastResolvedAt: number | null;
    };

export function parseMessageTargetHash(hash: string): number | null {
  const match = MESSAGE_TARGET_HASH.exec(hash);
  if (match === null) return null;

  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) ? sequence : null;
}

/**
 * Hash fragments are browser-only navigation state. Keep the server/client
 * first render identical, then resolve the current hash after hydration.
 */
export type MessageTargetControl = {
  targetSeq: number | null | undefined;
  // The time of the last target-send resolution (see MessageTargetState), or
  // null when no target send has finished since the last hash navigation.
  lastResolvedAt: number | null;
  resolveLatest: () => void;
};

export function useMessageTarget(chatId: string): MessageTargetControl {
  const [state, setState] = useState<MessageTargetState>({
    chatId,
    resolved: false,
  });

  useEffect(() => {
    const syncHash = () => {
      setState({
        chatId,
        resolved: true,
        targetSeq: parseMessageTargetHash(window.location.hash),
        // A plain hash navigation, not a finished target send: nothing has
        // resolved to latest, so there is no "post-send fresh history" to wait
        // for on the next live mount.
        lastResolvedAt: null,
      });
    };

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [chatId]);

  const resolveLatest = useCallback(() => {
    setState({
      chatId,
      resolved: true,
      targetSeq: null,
      lastResolvedAt: Date.now(),
    });
  }, [chatId]);

  return {
    resolveLatest,
    targetSeq:
      state.chatId === chatId && state.resolved ? state.targetSeq : undefined,
    lastResolvedAt:
      state.chatId === chatId && state.resolved ? state.lastResolvedAt : null,
  };
}
