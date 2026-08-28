import { useCallback, useEffect, useState } from "react";

const MESSAGE_TARGET_HASH = /^#msg-([1-9]\d*)$/;

type MessageTargetState =
  | { chatId: string; resolved: false }
  | { chatId: string; resolved: true; targetSeq: number | null };

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
      });
    };

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [chatId]);

  const resolveLatest = useCallback(() => {
    setState({ chatId, resolved: true, targetSeq: null });
  }, [chatId]);

  return {
    resolveLatest,
    targetSeq:
      state.chatId === chatId && state.resolved ? state.targetSeq : undefined,
  };
}
