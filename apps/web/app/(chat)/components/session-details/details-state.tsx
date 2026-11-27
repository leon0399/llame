"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";

import { SidebarProvider } from "@workspace/ui/components/sidebar";

import { MainRailProvider } from "@/app/shell/main-rail";

import { SESSION_DETAILS_COOKIE } from "./details-cookie";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * While the finished-jobs panel is open, the sidebar is the details column's
 * own 16rem plus the panel. The panel reads `--finished-jobs-width` for its
 * own width, so this one value sizes both; a resizable panel only changes it.
 */
// SAFETY: both keys are CSS custom properties, valid inline style keys that
// CSSProperties does not model; the vendored provider merges them last.
const WIDE_STYLE = {
  "--finished-jobs-width": "20rem",
  "--sidebar-width": "calc(16rem + var(--finished-jobs-width))",
} as CSSProperties;

/** The open chat's id, or undefined off a `/chat/:id` route. */
export function useOpenChatId(): string | undefined {
  const pathname = usePathname();

  return pathname.startsWith("/chat/") ? pathname.split("/")[2] : undefined;
}

interface FinishedJobsPanelState {
  /** The Chat the panel was opened on, or null while it is shut. */
  openFor: string | null;
  setOpenFor: (chatId: string | null) => void;
}

const FinishedJobsPanelContext = createContext<FinishedJobsPanelState | null>(
  null,
);

/** The finished-jobs panel's state, held here because it sets the width. */
export function useFinishedJobsPanelState(): FinishedJobsPanelState {
  const state = useContext(FinishedJobsPanelContext);

  if (state === null) {
    throw new Error("useFinishedJobsPanelState needs SessionDetailsProvider.");
  }

  return state;
}

/**
 * The session details sidebar's own provider, nested inside the main rail's
 * as the shadcn docs do for a second sidebar. Below it, `useSidebar` answers
 * for session details; the main rail stays reachable through `useMainRail`.
 * It is controlled so its open state persists in its own cookie, and it binds
 * no shortcut, leaving Cmd/Ctrl+B to the rail.
 *
 * It also holds the finished-jobs panel: the panel opens on the sidebar's outer
 * edge, so the sidebar widens toward the content, the way it slid in.
 */
export function SessionDetailsProvider({
  defaultOpen,
  children,
}: {
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpenState] = useState(defaultOpen);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const chatId = useOpenChatId();

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);

    // Reopening the details starts with the panel shut, so focus stays on
    // the control the owner pressed.
    if (!next) setOpenFor(null);

    document.cookie = `${SESSION_DETAILS_COOKIE}=${String(next)}; path=/; max-age=${String(COOKIE_MAX_AGE_SECONDS)}`;
  }, []);

  const wide = open && openFor !== null && openFor === chatId;

  return (
    <MainRailProvider>
      <FinishedJobsPanelContext value={{ openFor, setOpenFor }}>
        <SidebarProvider
          open={open}
          onOpenChange={setOpen}
          keyboardShortcut={null}
          className="h-full min-h-0 min-w-0"
          style={wide ? WIDE_STYLE : undefined}
        >
          {children}
        </SidebarProvider>
      </FinishedJobsPanelContext>
    </MainRailProvider>
  );
}
