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
import { Kbd } from "@workspace/ui/components/kbd";
import { usePrimaryModifierKey } from "@workspace/ui/hooks/use-modifier-key";
import { PanelLeftIcon } from "lucide-react";
import { topBarClasses } from "../top-bar";
import { AppSidebarAdminEntry } from "./app-sidebar-admin-entry";
import { AppSidebarNav } from "./app-sidebar-nav";
import { AppSidebarPinned } from "./app-sidebar-pinned";
import { AppSidebarUser } from "./app-sidebar-user";

export {
  SidebarInset,
  SidebarProvider,
} from "@workspace/ui/components/sidebar";

function AppSidebarToggle() {
  const { open, toggleSidebar } = useSidebar();
  const modifierKey = usePrimaryModifierKey();
  const label = open ? "Collapse sidebar" : "Expand sidebar";
  // The sidebar primitive owns the binding (Ctrl/⌘+B); this only shows it.
  const shortcut = `${modifierKey}+B`;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={{
            // Same tooltip shape as the rail's New Chat and Search actions.
            className:
              "flex items-center has-data-[slot=kbd]:gap-1.5 has-data-[slot=kbd]:pe-1.5",
            children: (
              <>
                {label}
                <Kbd>{shortcut}</Kbd>
              </>
            ),
          }}
          onClick={toggleSidebar}
          aria-keyshortcuts={`${modifierKey === "⌘" ? "Meta" : "Control"}+B`}
        >
          <PanelLeftIcon />
          <span>{label}</span>
          {/* Announced through `aria-keyshortcuts`, not the button's name. */}
          <Kbd
            aria-hidden="true"
            className="ml-auto group-data-[collapsible=icon]:hidden"
          >
            {shortcut}
          </Kbd>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function AppSidebarTopBar({
  isMobile,
  topActions,
}: {
  isMobile: boolean;
  topActions?: React.ReactNode;
}) {
  return (
    <>
      {!isMobile && (
        <div className={cn(topBarClasses, "border-sidebar-border p-2")}>
          <AppSidebarToggle />
        </div>
      )}

      {/* The separator closes the actions block — without topActions the
          toggle bar's own border-b is already the divider (rendering both
          doubles the hairline, e.g. on /admin). */}
      {topActions && (
        <>
          <SidebarHeader>{topActions}</SidebarHeader>
          <SidebarSeparator className="mx-0" />
        </>
      )}
    </>
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
      <AppSidebarTopBar isMobile={isMobile} topActions={topActions} />

      <SidebarContent>
        <AppSidebarNav />

        {/* The rail's mixed chats+projects "Pinned" section (AppShell.dc.html),
            between the nav and the bottom-pinned admin entry. Hides itself when
            the caller has no pins, so it adds no chrome for a fresh account. */}
        <AppSidebarPinned />

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
