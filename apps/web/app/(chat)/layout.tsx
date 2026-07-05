import { cookies } from "next/headers";
import { ChatProvider } from "@/contexts/chat-context";
import { CommandPaletteProvider } from "./components/command-palette";
import {
  SidebarInset,
  SidebarProvider,
  AppSidebar,
} from "./components/app-sidebar";
import { ChatListSidebar } from "./components/chat-list-sidebar";
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
        <ChatProvider>
          <CommandPaletteProvider>
            <AppSidebar />

            <ChatListSidebar />

            <SidebarInset className="flex h-full flex-col overflow-hidden">
              <ChatHeader className="sticky top-0" />

              {children}
            </SidebarInset>

            <ChatSidebar className="hidden!" />
          </CommandPaletteProvider>
        </ChatProvider>
      </SidebarProvider>
    </>
  );
}
