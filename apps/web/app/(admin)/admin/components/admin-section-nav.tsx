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

import {
  ADMIN_SECTIONS,
  isSectionActive,
  type AdminSection,
} from "./admin-sections";

/** One row of the "Instance" section list: a live link or a disabled "soon" placeholder. */
function AdminSectionMenuItem({
  section,
  isActive,
}: {
  section: AdminSection;
  isActive: boolean;
}) {
  return (
    <SidebarMenuItem>
      {section.href ? (
        <SidebarMenuButton
          render={<Link href={section.href} />}
          isActive={isActive}
          className="h-8.5"
        >
          <section.icon />
          <span>{section.label}</span>
        </SidebarMenuButton>
      ) : (
        <DisabledMenuButton className="h-8.5">
          <section.icon />
          <span className="flex flex-1 items-center truncate">
            {section.label}
          </span>
          <SoonChip />
        </DisabledMenuButton>
      )}
    </SidebarMenuItem>
  );
}

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
    <Sidebar collapsible="none" className="hidden w-68 shrink-0 md:flex">
      <div className={cn(topBarClasses, "gap-2 px-3.5")}>
        <ShieldIcon className="size-4.5 text-foreground" />
        <span className="text-base font-semibold">Administration</span>
      </div>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Instance</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ADMIN_SECTIONS.map((section) => (
                <AdminSectionMenuItem
                  key={section.key}
                  section={section}
                  isActive={isSectionActive(section, pathname)}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <div className="border-t px-4.5 py-3.5 font-mono text-xs text-muted-foreground">
        instance · {host}
      </div>
    </Sidebar>
  );
}
