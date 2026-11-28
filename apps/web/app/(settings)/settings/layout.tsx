import { cookies } from "next/headers";

import {
  SidebarInset,
  SidebarProvider,
  AppSidebar,
} from "@/app/shell/app-sidebar";
import { AppShellFrame } from "@/app/shell/app-shell-frame";
import { ActiveRunsProvider } from "@/contexts/active-runs-context";
import { LiveUpdatesProvider } from "@/contexts/live-updates-context";

import { SettingsHeader, SettingsRail } from "./components/settings-chrome";

/** The Settings area: the shared shell with its own section rail, the same
 *  composition as the Administration area. */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The main rail starts collapsed (icon mode); the cookie remembers an expand.
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";

  return (
    <AppShellFrame>
      <SidebarProvider defaultOpen={defaultOpen} className="min-h-0 flex-1">
        <LiveUpdatesProvider>
          <ActiveRunsProvider>
            <AppSidebar />
            <SettingsRail />
            <SidebarInset className="flex h-full flex-col overflow-hidden">
              <SettingsHeader />
              {children}
            </SidebarInset>
          </ActiveRunsProvider>
        </LiveUpdatesProvider>
      </SidebarProvider>
    </AppShellFrame>
  );
}
