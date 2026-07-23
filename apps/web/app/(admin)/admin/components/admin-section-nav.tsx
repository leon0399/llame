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
import { DisabledMenuButton } from "@/app/shell/app-sidebar/disabled-menu-button";
import { SoonChip } from "@/app/shell/soon-chip";

import { ADMIN_SECTIONS, isSectionActive } from "./admin-sections";

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
      <div className={cn(topBarClasses, "gap-2 px-[0.9rem]")}>
        <ShieldIcon className="size-[18px] text-foreground" />
        <span className="text-[0.95rem] font-semibold">Administration</span>
      </div>

      <SidebarContent>
        <SidebarGroup className="py-[0.6rem]">
          <SidebarGroupLabel className="h-auto px-[0.55rem] pt-[0.4rem] pb-[0.3rem] text-[0.7rem]">
            Instance
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-[0.1rem]">
              {ADMIN_SECTIONS.map((section) => {
                const isActive = isSectionActive(section, pathname);
                return (
                  <SidebarMenuItem key={section.key}>
                    {section.href ? (
                      <SidebarMenuButton
                        render={<Link href={section.href} />}
                        isActive={isActive}
                        className="h-[2.15rem] text-[0.86rem]"
                      >
                        <section.icon />
                        <span>{section.label}</span>
                      </SidebarMenuButton>
                    ) : (
                      <DisabledMenuButton className="h-[2.15rem] text-[0.86rem]">
                        <section.icon />
                        <span className="flex flex-1 items-center truncate">
                          {section.label}
                        </span>
                        <SoonChip />
                      </DisabledMenuButton>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <div className="border-t px-[1.1rem] py-[0.9rem] font-mono text-[0.72rem] tracking-[-0.01em] text-muted-foreground">
        instance · {host}
      </div>
    </Sidebar>
  );
}
