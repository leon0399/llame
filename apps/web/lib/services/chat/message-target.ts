import { useCallback, useEffect, useState } from "react";

const MESSAGE_TARGET_HASH = /^#msg-([1-9]\d*)$/;

type MessageTargetState =
  | { chatId: string; resolved: false }
  | {
      chatId: string;
      resolved: true;
      targetSeq: number | null;
      // True when `resolveLatest()` produced this state, i.e. an accepted
      // target-window send (finished or interrupted) returned the view to
      // latest; false on any plain hash navigation. The remounted live view
      // then skips the last-turn restore (#1084): the composer already holds
      // the selections that send used.
      resolvedAfterSend: boolean;
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
  // Whether the current resolution came from an accepted target send (see
  // MessageTargetState) rather than a hash navigation.
  resolvedAfterSend: boolean;
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
        resolvedAfterSend: false,
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
      resolvedAfterSend: true,
    });
  }, [chatId]);

  return {
    resolveLatest,
    targetSeq:
      state.chatId === chatId && state.resolved ? state.targetSeq : undefined,
    resolvedAfterSend:
      state.chatId === chatId && state.resolved && state.resolvedAfterSend,
  };
}
