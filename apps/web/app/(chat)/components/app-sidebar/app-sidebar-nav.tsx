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

type NavItem = {
  label: string;
  icon: LucideIcon;
  // Sections without a page yet have no href and render as disabled placeholders.
  href?: Route;
  // Sections whose UI is desktop-only for now render as disabled placeholders
  // on mobile instead of a dead-end link (same disabled-not-hidden convention).
  desktopOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboardIcon },
  { label: "Chats", icon: MessagesSquareIcon, href: "/" },
  // desktopOnly: the /projects list/create UI lives in the desktop-only
  // second rail; the mobile surface is deferred to the redesign.
  { label: "Projects", icon: FolderIcon, href: "/projects", desktopOnly: true },
  { label: "Gallery", icon: ImageIcon },
  { label: "Calendar", icon: CalendarIcon },
  { label: "Email", icon: MailIcon },
  { label: "Brain", icon: BrainIcon },
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
                  asChild
                  isActive={isItemActive(item.href)}
                  tooltip={item.label}
                >
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton
                  aria-disabled="true"
                  // Disabled ⇒ out of the tab order, like a natively disabled button.
                  tabIndex={-1}
                  tooltip={
                    item.desktopOnly
                      ? `${item.label} — on desktop for now`
                      : `${item.label} — coming soon`
                  }
                  // aria-disabled sets pointer-events-none, which would also suppress
                  // the collapsed-rail tooltip; keep pointer events but drop the
                  // interactive hover/active fills so the item stays visibly inert.
                  className="pointer-events-auto! cursor-default hover:bg-transparent! active:bg-transparent! hover:text-sidebar-foreground! active:text-sidebar-foreground!"
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
