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

/**
 * Registers a composer that always starts a new Chat — a project page's, which
 * never opens an existing one. It stores no selection, so the composer shows
 * the catalog default until the created Chat's first send stores one.
 */
export function useDraftChatSelection(chatId: string) {
  const { registerChatSelection } = useChatContext();

  useEffect(() => {
    registerChatSelection(chatId, null, false);
  }, [chatId, registerChatSelection]);
}
