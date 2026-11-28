"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
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
};

const NAV_ITEMS: Array<NavItem> = [
  { label: "Dashboard", icon: LayoutDashboardIcon, comingSoon: true },
  { label: "Chats", icon: MessagesSquareIcon, href: "/" },
  { label: "Projects", icon: FolderIcon, href: "/projects" },
  { label: "Gallery", icon: ImageIcon, href: "/gallery" },
  { label: "Calendar", icon: CalendarIcon, comingSoon: true },
  { label: "Email", icon: MailIcon, comingSoon: true },
  { label: "Brain", icon: BrainIcon, comingSoon: true },
];

function NavMenuRow({ item, isActive }: { item: NavItem; isActive: boolean }) {
  if (item.href) {
    return (
      <SidebarMenuButton
        render={<Link href={item.href} />}
        isActive={isActive}
        tooltip={item.label}
      >
        <item.icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
    );
  }

  return (
    <DisabledMenuButton tooltip={`${item.label} — coming soon`}>
      <item.icon />
      <span className="flex flex-1 items-center truncate">{item.label}</span>
      {item.comingSoon && <SoonChip />}
    </DisabledMenuButton>
  );
}

export function AppSidebarNav() {
  const pathname = usePathname();

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
              <NavMenuRow
                item={item}
                isActive={!!item.href && isItemActive(item.href)}
              />
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
