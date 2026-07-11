"use client";

import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { PanelLeftIcon } from "lucide-react";
import { topBarClasses } from "../top-bar";
import { AppSidebarAdminEntry } from "./app-sidebar-admin-entry";
import { AppSidebarNav } from "./app-sidebar-nav";
import { AppSidebarUser } from "./app-sidebar-user";

export {
  SidebarInset,
  SidebarProvider,
} from "@workspace/ui/components/sidebar";

function AppSidebarToggle() {
  const { open, toggleSidebar } = useSidebar();
  const label = open ? "Collapse sidebar" : "Expand sidebar";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton tooltip={label} onClick={toggleSidebar}>
          <PanelLeftIcon />
          <span>{label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * The primary rail, shared by every route group ((chat) and (admin)) — D1's
 * shell extraction. This component owns only presentation-agnostic pieces
 * (toggle, nav, user menu); route-group-specific header actions (e.g. the
 * chat area's New Chat/Search buttons) and mobile-only extra content (e.g.
 * the chat list) are passed in by the caller via `topActions`/`children`
 * rather than imported here, so this file has zero dependency on
 * ChatProvider/CommandPaletteProvider — the (admin) layout mounts neither.
 */
export function AppSidebar({
  topActions,
  children,
}: {
  topActions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { isMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      {!isMobile && (
        <div className={cn(topBarClasses, "border-sidebar-border p-2")}>
          <AppSidebarToggle />
        </div>
      )}

      {topActions && <SidebarHeader>{topActions}</SidebarHeader>}

      <SidebarSeparator className="mx-0" />

      <SidebarContent>
        <AppSidebarNav />

        {/* Route-group-specific mobile fallback content (e.g. the chat list,
            desktop-only otherwise) — never rendered when the caller has none. */}
        {isMobile && children && (
          <>
            <SidebarSeparator className="mx-0" />
            {children}
          </>
        )}
      </SidebarContent>

      {/* Administration's own bottom-pinned group (AppShell.dc.html) — OUTSIDE
          the scrollable SidebarContent, directly above the user footer, not
          among the main nav items and not in the user menu. */}
      <AppSidebarAdminEntry />

      {/* AppShell.dc.html separates the admin group from the profile block
          (border-top on the user footer). */}
      <SidebarSeparator className="mx-0" />

      <SidebarFooter>
        <AppSidebarUser />
      </SidebarFooter>
    </Sidebar>
  );
}
