import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useLatestRef } from "@/lib/hooks/use-latest-ref";

import { AgUiChat, type ChatInit, type ChatSnapshot } from "./chat";

/** The live log of the Chat and the operations that extend it. */
export type AgUiChatState = ChatSnapshot &
  Pick<
    AgUiChat,
    | "id"
    | "sendMessage"
    | "regenerate"
    | "resumeStream"
    | "stop"
    | "setMessages"
    | "clearError"
  >;

/** A departed view must not receive a late callback, including after a Chat switch. */
function useChatCallbacks(
  options: ChatInit,
): Pick<ChatInit, "onFinish" | "onError"> {
  const latest = useLatestRef(options);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  return {
    onFinish: (finish) => {
      if (mounted.current && latest.current.id === options.id)
        latest.current.onFinish(finish);
    },
    onError: (error) => {
      if (mounted.current && latest.current.id === options.id)
        latest.current.onError(error);
    },
  };
}

/** One engine per Chat id; the transport follows that Chat's view lifetime. */
export function useAgUiChat(options: ChatInit): AgUiChatState {
  const callbacks = useChatCallbacks(options);
  const create = () => new AgUiChat({ ...options, ...callbacks });
  const [held, setChat] = useState(create);
  let chat = held;

  if (chat.id !== options.id) {
    chat = create();
    setChat(chat);
  }

  useEffect(() => () => chat.stop(), [chat]);

  const snapshot = useSyncExternalStore(
    chat.subscribe,
    chat.getSnapshot,
    chat.getSnapshot,
  );

  return {
    ...snapshot,
    id: chat.id,
    sendMessage: chat.sendMessage,
    regenerate: chat.regenerate,
    resumeStream: chat.resumeStream,
    stop: chat.stop,
    setMessages: chat.setMessages,
    clearError: chat.clearError,
  };
}
