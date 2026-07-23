"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@workspace/ui/components/sidebar";
import {
  BrainIcon,
  CalendarIcon,
  FolderIcon,
  ImageIcon,
  LayoutDashboardIcon,
  MailIcon,
  MessagesSquareIcon,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { DisabledMenuButton } from "./disabled-menu-button";
import { SoonChip } from "../soon-chip";

type NavItem = {
  label: string;
  icon: LucideIcon;
  // Sections without a page yet have no href and render as disabled
  // placeholders with a visible "soon" chip (org-admin-ui spec "'Soon'-chip
  // parity").
  href?: Route;
  comingSoon?: boolean;
  // Sections whose UI is desktop-only for now render as disabled placeholders
  // on mobile instead of a dead-end link (same disabled-not-hidden convention).
  desktopOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboardIcon, comingSoon: true },
  { label: "Chats", icon: MessagesSquareIcon, href: "/" },
  // desktopOnly: the /projects list/create UI lives in the desktop-only
  // second rail; the mobile surface is deferred to the redesign.
  { label: "Projects", icon: FolderIcon, href: "/projects", desktopOnly: true },
  { label: "Gallery", icon: ImageIcon, comingSoon: true },
  { label: "Calendar", icon: CalendarIcon, comingSoon: true },
  { label: "Email", icon: MailIcon, comingSoon: true },
  { label: "Brain", icon: BrainIcon, comingSoon: true },
];

export function AppSidebarNav() {
  const pathname = usePathname();
  const { isMobile } = useSidebar();
  // Chats owns "/" and the /chat/* routes; any future section matches its own prefix.
  const isItemActive = (href: string) =>
    href === "/"
      ? pathname === "/" || pathname.startsWith("/chat/")
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAV_ITEMS.map((item) => (
            <SidebarMenuItem key={item.label}>
              {item.href && !(item.desktopOnly && isMobile) ? (
                <SidebarMenuButton
                  render={<Link href={item.href} />}
                  isActive={isItemActive(item.href)}
                  tooltip={item.label}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              ) : (
                <DisabledMenuButton
                  tooltip={
                    item.desktopOnly
                      ? `${item.label} — on desktop for now`
                      : `${item.label} — coming soon`
                  }
                >
                  <item.icon />
                  <span className="flex flex-1 items-center truncate">
                    {item.label}
                  </span>
                  {item.comingSoon && <SoonChip />}
                </DisabledMenuButton>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
