import { useEffect, useState } from "react";

const MESSAGE_TARGET_HASH = /^#msg-([1-9]\d*)$/;

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
export function useMessageTarget(chatId: string): number | null {
  const [state, setState] = useState<{
    chatId: string;
    targetSeq: number | null;
  }>({ chatId, targetSeq: null });

  useEffect(() => {
    const syncHash = () => {
      setState({
        chatId,
        targetSeq: parseMessageTargetHash(window.location.hash),
      });
    };

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [chatId]);

  return state.chatId === chatId ? state.targetSeq : null;
}
