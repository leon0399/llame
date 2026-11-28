import { useCallback, useRef, useState } from "react";

export type RunHandoff = {
  /** The ids the next attach waits for: it starts once any of them is in the
   *  log. Empty when no hand-off is pending. */
  awaited: ReadonlyArray<string>;
  /** Starts a hand-off to the segment that follows a message with this id. */
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
 * A delivered steer gets a new id, but the pending list only knows the item's
 * id, and the message id can arrive first or last. So `begin` adds every id it
 * is given and re-reads history; the attach starts when any one of them shows
 * up. Each id hands off once, however many signals name it.
 */
export function useRunHandoff(refreshChatMessages: () => void): RunHandoff {
  const [awaited, setAwaited] = useState<ReadonlyArray<string>>([]);
  const handled = useRef(new Set<string>());

  const begin = useCallback(
    (messageId: string) => {
      if (handled.current.has(messageId)) return;
      handled.current.add(messageId);
      setAwaited((current) => [...current, messageId]);
      refreshChatMessages();
    },
    [refreshChatMessages],
  );

  /** A message the owner withdrew is never delivered: it hands nothing off. */
  const skip = useCallback((messageId: string) => {
    handled.current.add(messageId);
  }, []);

  const settle = useCallback(() => setAwaited([]), []);

  return { awaited, begin, skip, settle };
}
