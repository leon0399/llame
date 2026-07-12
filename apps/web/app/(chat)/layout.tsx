import { cookies } from "next/headers";
import { ChatProvider } from "@/contexts/chat-context";
import { ActiveRunsProvider } from "@/contexts/active-runs-context";
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
import { ChatSidebar } from "./components/chat-sidebar";
import { ChatHeader } from "./components/chat-header";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The main rail starts collapsed (icon mode); the cookie remembers a user's expand.
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";

  return (
    <>
      {/* h-svh anchors the shell row's height once — the sidebars and inset all fill it. */}
      <SidebarProvider defaultOpen={defaultOpen} className="h-svh">
        <ActiveRunsProvider>
          <ChatProvider>
            <CommandPaletteProvider>
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

              <ChatSidebar className="hidden!" />
            </CommandPaletteProvider>
          </ChatProvider>
        </ActiveRunsProvider>
      </SidebarProvider>
    </>
  );
}
