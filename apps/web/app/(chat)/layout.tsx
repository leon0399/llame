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
import { ChatContextPanel } from "./components/chat-context-panel";
import { CHAT_CONTEXT_PANEL_COOKIE } from "./components/chat-context-panel/panel-cookie";
import { ChatContextPanelProvider } from "./components/chat-context-panel/panel-state";

/** The shell's remembered open states: the main rail starts collapsed (icon
 *  mode) until a user expands it; the context panel starts open until a user
 *  closes it. */
async function readShellState() {
  const cookieStore = await cookies();
  return {
    railOpen: cookieStore.get("sidebar_state")?.value === "true",
    contextPanelOpen:
      cookieStore.get(CHAT_CONTEXT_PANEL_COOKIE)?.value !== "false",
  };
}

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { railOpen, contextPanelOpen } = await readShellState();

  return (
    <>
      {/* h-svh anchors the shell row's height once — the sidebars and inset all fill it. */}
      <SidebarProvider defaultOpen={railOpen} className="h-svh">
        <LiveUpdatesProvider>
          <ActiveRunsProvider>
            <ChatProvider>
              <CommandPaletteProvider>
                <ChatListShowProvider>
                  <ChatContextPanelProvider defaultOpen={contextPanelOpen}>
                    {/* Chat-specific header actions + the mobile chat-list fallback are
                  injected into the shared shell here — AppSidebar itself has no
                  dependency on ChatProvider/CommandPaletteProvider (D1). */}
                    <AppSidebar topActions={<AppSidebarActions />}>
                      <ChatList />
                    </AppSidebar>

                    {/* Route-scoped second rails: each renders null off its route. */}
                    <ChatListSidebar />
                    <ProjectListSidebar />

                    <SidebarInset className="flex h-full flex-col overflow-hidden">
                      <ChatHeader className="sticky top-0" />

                      {children}
                    </SidebarInset>

                    <ChatContextPanel />
                  </ChatContextPanelProvider>
                </ChatListShowProvider>
              </CommandPaletteProvider>
            </ChatProvider>
          </ActiveRunsProvider>
        </LiveUpdatesProvider>
      </SidebarProvider>
    </>
  );
}
