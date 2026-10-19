import { cookies } from "next/headers";
import { ChatProvider } from "@/contexts/chat-context";
import { ActiveRunsProvider } from "@/contexts/active-runs-context";
import { LiveUpdatesProvider } from "@/contexts/live-updates-context";
import { CommandPaletteProvider } from "./components/command-palette";
import {
  SidebarInset,
  SidebarProvider,
  AppSidebar,
} from "@/app/shell/app-sidebar";
import { AppSidebarActions } from "./components/app-sidebar/app-sidebar-actions";
import { ChatList } from "./components/chat-list-sidebar/chat-list";
import { ChatListSidebar } from "./components/chat-list-sidebar";
import { ProjectListSidebar } from "./components/project-list-sidebar";
import { ChatHeader } from "./components/chat-header";
import { ChatListShowProvider } from "./components/chat-list-view";
import { SessionDetails } from "./components/session-details";
import {
  SESSION_DETAILS_COOKIE,
  SESSION_DETAILS_LAYOUT_COOKIE,
  parseSessionDetailsLayout,
} from "./components/session-details/details-cookie";
import { SessionDetailsProvider } from "./components/session-details/details-state";

/** The shell's remembered state: the main rail starts collapsed (icon mode)
 *  until a user expands it; session details start open until a user hides
 *  them, with their sections as the user arranged them. */
async function readShellState() {
  const cookieStore = await cookies();
  return {
    railOpen: cookieStore.get("sidebar_state")?.value === "true",
    detailsOpen: cookieStore.get(SESSION_DETAILS_COOKIE)?.value !== "false",
    detailsLayout: parseSessionDetailsLayout(
      cookieStore.get(SESSION_DETAILS_LAYOUT_COOKIE)?.value,
    ),
  };
}

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { railOpen, detailsOpen, detailsLayout } = await readShellState();

  return (
    <>
      {/* h-svh anchors the shell row's height once — the sidebars and inset all fill it. */}
      <SidebarProvider defaultOpen={railOpen} className="h-svh">
        <LiveUpdatesProvider>
          <ActiveRunsProvider>
            <ChatProvider>
              <CommandPaletteProvider>
                <ChatListShowProvider>
                  {/* Chat-specific header actions + the mobile chat-list fallback are
                  injected into the shared shell here — AppSidebar itself has no
                  dependency on ChatProvider/CommandPaletteProvider (D1). */}
                  <AppSidebar topActions={<AppSidebarActions />}>
                    <ChatList />
                  </AppSidebar>

                  {/* Route-scoped second rails: each renders null off its route. */}
                  <ChatListSidebar />
                  <ProjectListSidebar />

                  <SessionDetailsProvider defaultOpen={detailsOpen}>
                    <SidebarInset className="flex h-full flex-col overflow-hidden">
                      <ChatHeader className="sticky top-0" />

                      {children}
                    </SidebarInset>

                    <SessionDetails layout={detailsLayout} />
                  </SessionDetailsProvider>
                </ChatListShowProvider>
              </CommandPaletteProvider>
            </ChatProvider>
          </ActiveRunsProvider>
        </LiveUpdatesProvider>
      </SidebarProvider>
    </>
  );
}
