import type { ReactNode } from "react";

import { StatusBarFrame } from "@workspace/ui/components/status-bar";

import { AppStatusBar } from "./app-status-bar";

/** The signed-in shell: the layout's sidebars and content above the
 *  window-wide status bar. Its `SidebarProvider` child must fill the rest of
 *  the height (`min-h-0 flex-1`). */
export function AppShellFrame({ children }: { children: ReactNode }) {
  return (
    <StatusBarFrame>
      {children}
      <AppStatusBar />
    </StatusBarFrame>
  );
}
