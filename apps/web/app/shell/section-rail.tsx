"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";

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
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";

import { DisabledMenuButton } from "@/app/shell/app-sidebar/disabled-menu-button";
import { SoonChip } from "@/app/shell/soon-chip";
import { topBarClasses } from "@/app/shell/top-bar";

/*
 * The second rail of a sectioned area (Settings, Administration): a titled
 * column of grouped section links beside the main rail, a breadcrumb header
 * over the page, and the page's own title block. One definition, so both
 * areas look and behave alike.
 */

export type RailSection = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Only built sections have a route; the rest render as visible, disabled
   *  "soon" rows (repo convention: unimplemented UI is shown, not hidden). */
  href?: Route;
};

export type RailGroup = { label: string; sections: Array<RailSection> };

export type SectionArea = {
  title: string;
  icon: LucideIcon;
  groups: Array<RailGroup>;
};

/** The one definition of "is this section the open one". */
export function isSectionActive(
  section: RailSection,
  pathname: string,
): boolean {
  return !!section.href && pathname.startsWith(section.href);
}

/** The open section, falling back to the first built one so the header
 *  always has a title. */
export function activeSection(
  area: SectionArea,
  pathname: string,
): RailSection | undefined {
  const sections = area.groups.flatMap((group) => group.sections);

  return (
    sections.find((section) => isSectionActive(section, pathname)) ??
    sections.find((section) => section.href !== undefined)
  );
}

function SectionMenuItem({
  section,
  isActive,
}: {
  section: RailSection;
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

/** Desktop-only, like the projects and chats rails; on a phone the area's
 *  pages carry their own section switcher (`SectionPicker`). */
export function SectionRail({
  area,
  footer,
}: {
  area: SectionArea;
  footer?: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="none" className="hidden w-68 shrink-0 md:flex">
      <div className={cn(topBarClasses, "gap-2 px-3.5")}>
        <area.icon className="size-4.5 text-foreground" />
        <span className="text-base font-semibold">{area.title}</span>
      </div>

      <SidebarContent>
        {area.groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.sections.map((section) => (
                  <SectionMenuItem
                    key={section.key}
                    section={section}
                    isActive={isSectionActive(section, pathname)}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {footer}
    </Sidebar>
  );
}

function SectionPickerItem({ section }: { section: RailSection }) {
  return (
    <DropdownMenuItem
      disabled={section.href === undefined}
      render={
        section.href === undefined ? undefined : <Link href={section.href} />
      }
    >
      <section.icon />
      {section.label}
      {section.href === undefined ? <SoonChip /> : null}
    </DropdownMenuItem>
  );
}

/** The phone's way between sections, where the rail is hidden: the
 *  breadcrumb's section name opens the area's section list. */
function SectionPicker({
  area,
  current,
}: {
  area: SectionArea;
  current: RailSection | undefined;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="md:hidden">
            {current?.label}
            <ChevronDownIcon aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-56">
        {area.groups.map((group) => (
          <DropdownMenuGroup key={group.label}>
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.sections.map((section) => (
              <SectionPickerItem key={section.key} section={section} />
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "<Area> › <Section>" over every page of the area, as shadcn's breadcrumb:
 *  the current section in regular weight, not bold. */
export function SectionHeader({
  area,
  leading,
}: {
  area: SectionArea;
  /** Mobile-only controls before the breadcrumb (the rail's trigger). */
  leading?: ReactNode;
}) {
  const pathname = usePathname();
  const section = activeSection(area, pathname);

  return (
    <header className={cn(topBarClasses, "gap-1.75 bg-background px-3.5")}>
      {leading}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>{area.title}</BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            {/* On a phone the current section is the picker that changes
                it; from `md` the rail does, and it is plain text. */}
            <BreadcrumbPage className="hidden md:inline">
              {section?.label}
            </BreadcrumbPage>
            <SectionPicker area={area} current={section} />
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}

/** One section page: its title and description over the content, in the
 *  area's reading column. The page scrolls, not the shell. */
export function SectionPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="h-full w-full overflow-y-auto px-4 py-6 md:px-7">
      <div className="mx-auto flex w-full max-w-195 flex-col gap-6">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description === undefined ? null : (
            <p className="max-w-prose text-sm leading-normal text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
