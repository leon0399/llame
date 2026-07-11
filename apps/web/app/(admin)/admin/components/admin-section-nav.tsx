"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { ShieldIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { topBarClasses } from "@/app/shell/top-bar";
import { SoonChip } from "@/app/shell/soon-chip";

import { ADMIN_SECTIONS } from "./admin-sections";

/**
 * The admin area's second rail (D1): "Administration" header, an "Instance"
 * group, and the section list — Organizations is the only live link, the
 * rest render disabled with a "soon" chip (disabled-not-hidden, same
 * convention as the primary sidebar's placeholders). Desktop-only, same
 * pattern as project-list-sidebar — the primary-rail "Administration" entry
 * itself is also desktop-only, so there's no mobile path that reaches here.
 */
export function AdminSectionNav({ host }: { host: string }) {
  const pathname = usePathname();

  return (
    <Sidebar
      collapsible="none"
      className="hidden w-[17rem] shrink-0 border-r bg-background md:flex"
    >
      <div className={cn(topBarClasses, "gap-2 px-3")}>
        <ShieldIcon className="size-[18px] text-foreground" />
        <span className="text-sm font-semibold">Administration</span>
      </div>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Instance</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ADMIN_SECTIONS.map((section) => {
                const isActive = !!section.href && pathname.startsWith(section.href);
                return (
                  <SidebarMenuItem key={section.key}>
                    {section.href ? (
                      <SidebarMenuButton asChild isActive={isActive}>
                        <Link href={section.href}>
                          <section.icon />
                          <span>{section.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    ) : (
                      <SidebarMenuButton
                        aria-disabled="true"
                        tabIndex={-1}
                        className="pointer-events-auto! cursor-default hover:bg-transparent! active:bg-transparent!"
                      >
                        <section.icon />
                        <span className="flex flex-1 items-center truncate">
                          {section.label}
                        </span>
                        <SoonChip />
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <div className="border-t p-2 font-mono text-xs text-muted-foreground">
        instance · {host}
      </div>
    </Sidebar>
  );
}
