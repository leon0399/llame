import { useCallback, useRef, useState } from "react";

export type RunHandoff = {
  /** The delivered message the next attach waits for, or null. */
  awaited: string | null;
  /** Starts a hand-off to the segment that follows `messageId`. */
  begin: (messageId: string) => void;
  /** Marks a message that must never hand off (the owner withdrew it). */
  skip: (messageId: string) => void;
  /** Ends the wait: the attach started. */
  settle: () => void;
};

/**
 * The hand-off from one Run segment to the next (run-steering D9, D11). A
 * delivered message ends the UI stream of its segment, and one UI message
 * streams once, so the next segment needs a new attach. The attach waits until
 * the live log holds the delivered message: the stream's last reply must give
 * way to the durable one first, or the resumed stream would continue it.
 *
 * `begin` names the message to wait for and re-reads history. Each message
 * hands off once, however many signals name it: the segment's stream, a 409 on
 * an action, and the pending list shrinking all report the same delivery.
 */
export function useRunHandoff(refreshChatMessages: () => void): RunHandoff {
  const [awaited, setAwaited] = useState<string | null>(null);
  const handled = useRef(new Set<string>());

  const begin = useCallback(
    (messageId: string) => {
      if (handled.current.has(messageId)) return;
      handled.current.add(messageId);
      setAwaited(messageId);
      refreshChatMessages();
    },
    [refreshChatMessages],
  );

  /** A message the owner withdrew is never delivered: it hands nothing off. */
  const skip = useCallback((messageId: string) => {
    handled.current.add(messageId);
  }, []);

  const settle = useCallback(() => setAwaited(null), []);

  return { awaited, begin, skip, settle };
}
