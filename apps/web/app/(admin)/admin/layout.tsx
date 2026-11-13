import { cookies, headers } from "next/headers";

import {
  SidebarInset,
  SidebarProvider,
  AppSidebar,
} from "@/app/shell/app-sidebar";
import { AppShellFrame } from "@/app/shell/app-shell-frame";
import { ActiveRunsProvider } from "@/contexts/active-runs-context";
import { LiveUpdatesProvider } from "@/contexts/live-updates-context";
import { AdminHeader } from "./components/admin-header";
import { AdminSectionNav } from "./components/admin-section-nav";

/**
 * The Administration area's own layout (D1): composes the SAME shared shell
 * as the (chat) layout, with the live state needed by the pinned rail but
 * without chat-specific machinery (ChatProvider, CommandPaletteProvider,
 * ChatHeader, or chat/project second rails). */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The main rail starts collapsed (icon mode); the cookie remembers a user's
  // expand — same convention as the (chat) layout.
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";

  // Display-only caption for the section nav's footer ("instance · <host>").
  // Host is client-controlled unless the proxy validates it — never use this
  // value for links, redirects, or authorization.
  const headerStore = await headers();
  const host = headerStore.get("host") ?? "instance";

  return (
    <AppShellFrame>
      <SidebarProvider defaultOpen={defaultOpen} className="min-h-0 flex-1">
        {/* The status bar's Machine overview relies on live pushes, not a poll. */}
        <LiveUpdatesProvider>
          <ActiveRunsProvider>
            <AppSidebar />

            <AdminSectionNav host={host} />

            <SidebarInset className="flex h-full flex-col overflow-hidden">
              <AdminHeader />

              {children}
            </SidebarInset>
          </ActiveRunsProvider>
        </LiveUpdatesProvider>
      </SidebarProvider>
    </AppShellFrame>
  );
}
