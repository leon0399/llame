"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
} from "react";
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

const WIDE_QUERY = "(min-width: 80rem)";

function subscribeToWide(onChange: () => void) {
  const query = window.matchMedia(WIDE_QUERY);

  query.addEventListener("change", onChange);

  return () => query.removeEventListener("change", onChange);
}

/** Room for the chats rail, the transcript and session details side by
 *  side (80rem). The server assumes it, like the desktop branch elsewhere. */
function useWideViewport(): boolean {
  return useSyncExternalStore(
    subscribeToWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

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
  // Below 80rem the details would squeeze the transcript to a column, so
  // they start shut there; opening them is per visit and leaves the saved
  // desktop preference alone.
  const wideViewport = useWideViewport();
  const [narrowOpen, setNarrowOpen] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const chatId = useOpenChatId();

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    document.cookie = `${SESSION_DETAILS_COOKIE}=${String(next)}; path=/; max-age=${String(COOKIE_MAX_AGE_SECONDS)}`;
  }, []);

  const shown = wideViewport ? open : narrowOpen;
  const wide = shown && openFor !== null && openFor === chatId;

  return (
    <MainRailProvider>
      <FinishedJobsPanelContext value={{ openFor, setOpenFor }}>
        <SidebarProvider
          open={shown}
          onOpenChange={wideViewport ? setOpen : setNarrowOpen}
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
