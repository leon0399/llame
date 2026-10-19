"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { PanelLeftIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  useSidebar,
  type SidebarContextProps,
} from "@workspace/ui/components/sidebar";

const MainRailContext = createContext<SidebarContextProps | null>(null);

/**
 * Re-provides the main rail's sidebar state beneath a nested sidebar
 * provider (the session details sidebar's), where `useSidebar` answers for the
 * nested sidebar instead. Mount it inside the rail's provider, around the
 * nested one.
 */
export function MainRailProvider({ children }: { children: ReactNode }) {
  const rail = useSidebar();
  return (
    <MainRailContext.Provider value={rail}>{children}</MainRailContext.Provider>
  );
}

/** The main rail's state: re-provided under a nested sidebar, else the
 *  nearest sidebar, which is then the rail itself. */
export function useMainRail(): SidebarContextProps {
  const nearest = useSidebar();
  return useContext(MainRailContext) ?? nearest;
}

/** Mobile-only button that opens the main rail's sheet. */
export function MainRailTrigger() {
  const { toggleSidebar } = useMainRail();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="md:hidden"
      onClick={toggleSidebar}
    >
      <PanelLeftIcon />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}
