"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

import { CHAT_CONTEXT_PANEL_COOKIE } from "./panel-cookie";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

interface ChatContextPanelState {
  /** Desktop: the docked panel is shown. */
  open: boolean;
  /** Mobile: the panel sheet is shown; never remembered. */
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  toggle: (isMobile: boolean) => void;
}

const ChatContextPanelContext = createContext<ChatContextPanelState | null>(
  null,
);

export function useChatContextPanel(): ChatContextPanelState {
  const state = useContext(ChatContextPanelContext);
  if (state === null) {
    throw new Error(
      "useChatContextPanel must be used within a ChatContextPanelProvider.",
    );
  }
  return state;
}

/**
 * Open state for the chat's right-hand context panel. Desktop and mobile are
 * separate, as for the main rail: the desktop choice persists in a cookie so
 * the server renders the panel the way it was left, while the mobile sheet
 * always starts closed.
 */
export function ChatContextPanelProvider({
  defaultOpen,
  children,
}: {
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [openMobile, setOpenMobile] = useState(false);

  const toggle = useCallback(
    (isMobile: boolean) => {
      if (isMobile) {
        setOpenMobile((current) => !current);
        return;
      }
      const next = !open;
      setOpen(next);
      document.cookie = `${CHAT_CONTEXT_PANEL_COOKIE}=${String(next)}; path=/; max-age=${String(COOKIE_MAX_AGE_SECONDS)}`;
    },
    [open],
  );

  return (
    <ChatContextPanelContext.Provider
      value={{ open, openMobile, setOpenMobile, toggle }}
    >
      {children}
    </ChatContextPanelContext.Provider>
  );
}
