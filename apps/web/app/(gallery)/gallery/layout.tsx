import { cookies } from "next/headers";

import {
  SidebarInset,
  SidebarProvider,
  AppSidebar,
} from "@/app/shell/app-sidebar";

/**
 * The Gallery's own layout: the shared shell's primary rail only, like the
 * Administration area. No chat or project second rail and no chat header, so
 * the grid takes the whole inset.
 */
export default async function GalleryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The main rail starts collapsed (icon mode); the cookie remembers a user's
  // expand — same convention as the (chat) layout.
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";

  return (
    <SidebarProvider defaultOpen={defaultOpen} className="h-svh">
      <AppSidebar />
      <SidebarInset className="flex h-full flex-col overflow-hidden">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
