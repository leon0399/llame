"use client";

import { useEffect } from "react";

import { useChatContext } from "@/contexts/chat-context";
import { useOpenChat } from "@/lib/services/chat/queries";

/**
 * Registers the open Chat's stored model selection with the composer: the
 * Chat read's `modelSelection`, or none for a Chat that does not exist yet.
 * Observational only — the sidebar and header own the Chat reads, so this adds
 * no request and follows whatever they keep fresh.
 */
export function useChatDisplayedSelection(chatId: string, exists: boolean) {
  const { registerChatSelection } = useChatContext();

  const chat = useOpenChat(exists ? chatId : undefined, { fetch: false });
  const selection = chat?.modelSelection ?? null;

  useEffect(() => {
    registerChatSelection(chatId, selection, exists);
  }, [chatId, exists, registerChatSelection, selection]);
}
