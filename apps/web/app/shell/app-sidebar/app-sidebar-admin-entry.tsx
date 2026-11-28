"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
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
 * `SidebarFooter`, outside the scrolling area). On a phone the area's
 * pages switch sections from the breadcrumb, where the rail is hidden.
 */
export function AppSidebarAdminEntry() {
  const pathname = usePathname();
  const isActive = pathname.startsWith("/admin");

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href={ADMIN_HREF} />}
              isActive={isActive}
              tooltip="Administration"
            >
              <ShieldIcon />
              <span>Administration</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
