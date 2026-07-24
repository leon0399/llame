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
import { DisabledMenuButton } from "./disabled-menu-button";
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
              <DisabledMenuButton tooltip="Administration — on desktop for now">
                <ShieldIcon />
                <span>Administration</span>
              </DisabledMenuButton>
            ) : (
              <SidebarMenuButton
                render={<Link href={ADMIN_HREF} />}
                isActive={isActive}
                tooltip="Administration"
              >
                <ShieldIcon />
                <span>Administration</span>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
