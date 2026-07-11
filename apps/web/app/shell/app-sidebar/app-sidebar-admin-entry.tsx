"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@workspace/ui/components/sidebar";
import { ShieldIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ADMIN_HREF = "/admin/organizations";

/**
 * Administration's own bottom-pinned group (AppShell.dc.html): NOT one of
 * the main nav items and NOT in the user menu — its own section rendered
 * after the scrollable nav content, directly above the user-profile footer
 * (see app-sidebar/index.tsx: this sits between `SidebarContent` and
 * `SidebarFooter`, outside the scrolling area). Desktop-only, same
 * disabled-not-hidden-with-tooltip convention as AppSidebarNav's other
 * desktop-only items (Projects).
 */
export function AppSidebarAdminEntry() {
  const pathname = usePathname();
  const { isMobile } = useSidebar();
  const isActive = pathname.startsWith("/admin");

  return (
    <SidebarGroup className="p-2">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            {isMobile ? (
              <SidebarMenuButton
                aria-disabled="true"
                // Disabled ⇒ out of the tab order, like a natively disabled button.
                tabIndex={-1}
                tooltip="Administration — on desktop for now"
                // aria-disabled sets pointer-events-none, which would also suppress
                // the collapsed-rail tooltip; keep pointer events but drop the
                // interactive hover/active fills so the item stays visibly inert.
                className="pointer-events-auto! cursor-default hover:bg-transparent! active:bg-transparent! hover:text-sidebar-foreground! active:text-sidebar-foreground!"
              >
                <ShieldIcon />
                <span>Administration</span>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                asChild
                isActive={isActive}
                tooltip="Administration"
              >
                <Link href={ADMIN_HREF}>
                  <ShieldIcon />
                  <span>Administration</span>
                </Link>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
