import { cookies } from "next/headers";

import { AppShellFrame } from "@/app/shell/app-shell-frame";
import { AppSidebar, SidebarProvider } from "@/app/shell/app-sidebar";
import { AppSidebarActions } from "@/app/shell/app-sidebar/app-sidebar-actions";
import { CommandPaletteProvider } from "@/app/shell/command-palette";
import { ActiveRunsProvider } from "@/contexts/active-runs-context";
import { LiveUpdatesProvider } from "@/contexts/live-updates-context";

import { ChatList } from "./(chat)/components/chat-list-sidebar/chat-list";
import { ChatListShowProvider } from "./(chat)/components/chat-list-view";

/**
 * Every signed-in page: the frame and status bar, the live connection, the
 * command palette, and the main rail with New chat and Search. Chats,
 * Settings and Administration are route groups under it, so moving between
 * them keeps this shell (and its live connection) mounted; each area's own
 * layout adds only its second rail, its header and its page. On a phone the
 * main rail is a sheet that also lists the owner's chats, in every area.
 */
export default async function SignedInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The main rail starts collapsed (icon mode); the cookie remembers an
  // expand.
  const cookieStore = await cookies();
  const railOpen = cookieStore.get("sidebar_state")?.value === "true";

  return (
    <AppShellFrame>
      {/* The shell row fills the height above the status bar; the sidebars
          and the inset all fill it. */}
      <SidebarProvider defaultOpen={railOpen} className="min-h-0 flex-1">
        <LiveUpdatesProvider>
          <ActiveRunsProvider>
            <CommandPaletteProvider>
              <ChatListShowProvider>
                <AppSidebar topActions={<AppSidebarActions />}>
                  <ChatList />
                </AppSidebar>
                {children}
              </ChatListShowProvider>
            </CommandPaletteProvider>
          </ActiveRunsProvider>
        </LiveUpdatesProvider>
      </SidebarProvider>
    </AppShellFrame>
  );
}
