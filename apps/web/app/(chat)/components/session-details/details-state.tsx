"use client";

import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import { SidebarProvider } from "@workspace/ui/components/sidebar";

import { MainRailProvider } from "@/app/shell/main-rail";

import { SESSION_DETAILS_COOKIE } from "./details-cookie";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The session details sidebar's own provider, nested inside the main rail's
 * as the shadcn docs do for a second sidebar. Below it, `useSidebar` answers
 * for session details; the main rail stays reachable through `useMainRail`.
 * It is controlled so its open state persists in its own cookie, and it binds
 * no shortcut, leaving Cmd/Ctrl+B to the rail.
 */
export function SessionDetailsProvider({
  defaultOpen,
  children,
}: {
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpenState] = useState(defaultOpen);
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    document.cookie = `${SESSION_DETAILS_COOKIE}=${String(next)}; path=/; max-age=${String(COOKIE_MAX_AGE_SECONDS)}`;
  }, []);

  return (
    <MainRailProvider>
      <SidebarProvider
        open={open}
        onOpenChange={setOpen}
        keyboardShortcut={null}
        className="h-full min-h-0 min-w-0"
      >
        {children}
      </SidebarProvider>
    </MainRailProvider>
  );
}
