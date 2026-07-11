import { cookies, headers } from "next/headers";

import {
  SidebarInset,
  SidebarProvider,
  AppSidebar,
} from "@/app/shell/app-sidebar";

import { AdminHeader } from "./components/admin-header";
import { AdminSectionNav } from "./components/admin-section-nav";

/**
 * The Administration area's own layout (D1): composes the SAME shared shell
 * as the (chat) layout, but carries none of the chat-specific machinery
 * (ChatProvider, ActiveRunsProvider, CommandPaletteProvider, ChatHeader,
 * chat/project second rails) — `AppSidebar` here has no header actions and no
 * mobile-fallback children, so it never needs those providers to mount.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The main rail starts collapsed (icon mode); the cookie remembers a user's
  // expand — same convention as the (chat) layout.
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";

  const headerStore = await headers();
  const host = headerStore.get("host") ?? "instance";

  return (
    <SidebarProvider defaultOpen={defaultOpen} className="h-svh">
      <AppSidebar />

      <AdminSectionNav host={host} />

      <SidebarInset className="flex h-full flex-col overflow-hidden">
        <AdminHeader />

        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
