"use client";

import { useState, type ComponentProps, type ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Button } from "@workspace/ui/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@workspace/ui/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  FolderIcon,
  FolderPlusIcon,
  MoreHorizontalIcon,
  SearchIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ArchivedBadge } from "@/components/archived-badge";
import { CollapsibleSidebarGroup } from "@/components/collapsible-sidebar-group";
import { PinButton } from "@/components/pin-button";
import { SearchFilterInput } from "@/components/search-filter-input";
import { HoverReveal, SidebarRowAction } from "@/components/hover-reveal";
import { SidebarRowTitle } from "@/components/sidebar-row-title";
import type { ProjectResponse } from "@/lib/services/project/types";
import { type ListShow, ListViewChip, ListViewMenu } from "../chat-list-view";
import { SidebarRowSkeletons } from "../sidebar-row-skeletons";
import { topBarClasses } from "@/app/shell/top-bar";
import { NewProjectDialog } from "../chat-list-sidebar/project-dialogs";
import {
  ProjectDialogs,
  ProjectMenuItems,
  useProjectDialogs,
  useProjectItemPin,
} from "./project-actions";
import { useProjectListData } from "./project-list-data";

function ProjectRowMenu({
  isActive,
  ...items
}: ComponentProps<typeof ProjectMenuItems> & { isActive: boolean }) {
  return (
    <DropdownMenu modal={true}>
      <HoverReveal atRest={isActive}>
        <DropdownMenuTrigger render={<SidebarRowAction />}>
          <MoreHorizontalIcon />
          <span className="sr-only">More</span>
        </DropdownMenuTrigger>
      </HoverReveal>
      <ProjectMenuItems {...items} />
    </DropdownMenu>
  );
}

function ProjectRowLabel({
  project,
  isActive,
  isArchived,
}: {
  project: ProjectResponse;
  isActive: boolean;
  isArchived: boolean;
}) {
  return (
    <SidebarMenuButton
      variant="chromeless"
      className="min-w-0 flex-1"
      isActive={isActive}
      render={<Link href={`/projects/${project.id}`} />}
    >
      {/* Archived rows read as de-emphasized (mock's `.sec-item[data-archived]`
          icon opacity + muted title). */}
      <FolderIcon
        className={cn("text-muted-foreground", isArchived && "opacity-50")}
      />
      {/* Wrapper so the row's `[&>span:last-child]:truncate` rule lands here
          and not on the name, which fades rather than ellipses. */}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <SidebarRowTitle
          text={project.name}
          animateChanges
          className={cn(isArchived && "text-muted-foreground")}
        />
        {isArchived && <ArchivedBadge />}
      </span>
    </SidebarMenuButton>
  );
}

// One project row, mirroring ChatItem's shape: icon + name, a live pin
// toggle (design D2/D5a — the unified /api/v1/pins resource, pins is the
// sole source of pin state), and a "…" menu with Edit details / Archive /
// Delete.
type ProjectItemProps = {
  project: ProjectResponse;
  isActive: boolean;
  /** From the caller's `usePins()` — this project carries no pin field of its own. */
  isPinned: boolean;
};

const projectRowClassName = cn(
  "flex items-center rounded-md pr-1 hover:bg-sidebar-accent has-[a:focus-visible]:inset-ring-2 has-[a:focus-visible]:inset-ring-sidebar-ring",
);

export function ProjectItem({ project, isActive, isPinned }: ProjectItemProps) {
  const isArchived = project.archivedAt !== null;
  const togglePin = useProjectItemPin(project, isPinned);
  const dialogs = useProjectDialogs();

  return (
    // In-flow actions and a row-level fill, exactly as ChatItem — see
    // HoverReveal for why the row reserves nothing while they are hidden, and
    // ChatItemRow for why the surface is painted by this plain div instead of
    // the `SidebarMenuItem`, which stays the list-semantics `<li>` and the
    // `group/menu-item` scope the variants and the row's own lookups rely on.
    <SidebarMenuItem>
      <div className={cn(projectRowClassName, isActive && "bg-sidebar-accent")}>
        <ProjectRowLabel
          project={project}
          isActive={isActive}
          isArchived={isArchived}
        />
        <PinButton isPinned={isPinned} togglePin={togglePin} />
        <ProjectRowMenu
          project={project}
          isActive={isActive}
          isPinned={isPinned}
          onTogglePin={togglePin}
          onEdit={dialogs.openEdit}
          onDelete={dialogs.openDelete}
        />
        <ProjectDialogs project={project} dialogs={dialogs} />
      </div>
    </SidebarMenuItem>
  );
}

type ListView = { show: ListShow; onShowChange: (show: ListShow) => void };
type ProjectSearch = { query: string; onQueryChange: (query: string) => void };

/** A header icon button, labelled by its tooltip. */
function HeaderAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onClick}
          />
        }
      >
        {children}
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Where the search button sits; while searching, the field in its place. */
function SearchSlot({
  searching,
  search,
  onSearchingChange,
}: {
  searching: boolean;
  search: ProjectSearch;
  onSearchingChange: (searching: boolean) => void;
}) {
  if (!searching)
    return (
      <HeaderAction
        label="Search projects"
        onClick={() => onSearchingChange(true)}
      >
        <SearchIcon />
      </HeaderAction>
    );
  return (
    <SearchFilterInput
      value={search.query}
      onChange={search.onQueryChange}
      placeholder="Search projects…"
      focusOnMount
      onClose={() => onSearchingChange(false)}
    />
  );
}

const HEADER_MOTION = "transition-all duration-200 ease-linear";

/** The rail's title, narrowing to nothing while the search field is open.
 *  Its trailing space is a margin, not the bar's gap, so it collapses with
 *  it and leaves the field even spacing. */
function HeaderTitle({ searching }: { searching: boolean }) {
  return (
    <span
      aria-hidden={searching}
      className={cn(
        "basis-0 overflow-hidden text-sm font-semibold whitespace-nowrap",
        HEADER_MOTION,
        searching ? "mr-0 grow-0 opacity-0" : "mr-2 grow",
      )}
    >
      Projects
    </span>
  );
}

/** The view menu and New project, narrowing to nothing (and leaving the tab
 *  order) while the search field is open; leading space as for the title. */
function HeaderActions({
  searching,
  view,
  onNewProject,
}: {
  searching: boolean;
  view: ListView;
  onNewProject: () => void;
}) {
  return (
    <div
      inert={searching}
      // Clipped only while collapsed: a focus ring draws outside its
      // button, so a clipping box would crop it.
      className={cn(
        "flex shrink-0 gap-2",
        HEADER_MOTION,
        searching ? "ml-0 w-0 overflow-hidden opacity-0" : "ml-2 w-18",
      )}
    >
      <ListViewMenu {...view} />
      <HeaderAction label="New project" onClick={onNewProject}>
        <FolderPlusIcon />
      </HeaderAction>
    </div>
  );
}

/**
 * The rail's top bar: its title and actions, or — once Search is chosen —
 * the search field, focused. The field grows out of the search button's own
 * place: the slot widens while the title and the other actions narrow to
 * nothing on either side of it, and the bar's padding evens out around it.
 * Its × or Escape clears the query and brings the actions back, as does
 * leaving an empty field.
 */
function ProjectListSidebarHeader({
  view,
  search,
  onNewProject,
}: {
  view: ListView;
  search: ProjectSearch;
  onNewProject: () => void;
}) {
  const [searching, setSearching] = useState(false);
  return (
    <div
      className={cn(
        topBarClasses,
        HEADER_MOTION,
        searching ? "px-1.5" : "pr-1.5 pl-3",
      )}
    >
      <HeaderTitle searching={searching} />
      <div
        className={cn(
          "min-w-8 basis-8",
          HEADER_MOTION,
          searching ? "grow" : "grow-0",
        )}
      >
        <SearchSlot
          searching={searching}
          search={search}
          onSearchingChange={setSearching}
        />
      </div>
      <HeaderActions
        searching={searching}
        view={view}
        onNewProject={onNewProject}
      />
    </div>
  );
}

function EmptyProjectsMessage({ text }: { text: string }) {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <div className="px-2 text-muted-foreground w-full flex flex-row justify-center items-center text-sm gap-2">
          {text}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function ProjectListSkeleton() {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarRowSkeletons />
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** A group's project rows. */
function ProjectRows({
  projects,
  pathname,
  isPinned,
}: {
  projects: Array<ProjectResponse>;
  pathname: string;
  isPinned: (projectId: string) => boolean;
}) {
  return (
    <SidebarGroupContent>
      <SidebarMenu>
        {projects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            isActive={pathname === `/projects/${project.id}`}
            isPinned={isPinned(project.id)}
          />
        ))}
      </SidebarMenu>
    </SidebarGroupContent>
  );
}

/** The Pinned section, folding away from its heading as the chats rail's
 *  does. Every row in it is pinned, whether or not the pins map has loaded. */
function PinnedProjectGroup({
  projects,
  pathname,
}: {
  projects: Array<ProjectResponse>;
  pathname: string;
}) {
  if (projects.length === 0) return null;
  return (
    <CollapsibleSidebarGroup title="Pinned">
      <ProjectRows
        projects={projects}
        pathname={pathname}
        isPinned={() => true}
      />
    </CollapsibleSidebarGroup>
  );
}

function ProjectGroup({
  label,
  projects,
  pathname,
  pinnedIds,
}: {
  label: string | null;
  projects: Array<ProjectResponse>;
  pathname: string;
  pinnedIds: ReadonlyMap<string, string>;
}) {
  if (projects.length === 0) return null;
  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <ProjectRows
        projects={projects}
        pathname={pathname}
        isPinned={(projectId) => pinnedIds.has(projectId)}
      />
    </SidebarGroup>
  );
}

const NO_PROJECTS_TEXT = new Map<ListShow, string>([
  ["active", "No projects yet — create one to group your chats."],
  ["archived", "No archived projects."],
  ["all", "No projects yet — create one to group your chats."],
]);

type ProjectListSidebarContentProps = ReturnType<typeof useProjectListData> & {
  show: ListShow;
  pathname: string;
};

function ProjectListSidebarContent(props: ProjectListSidebarContentProps) {
  const { pinnedProjects, listedProjects, pinnedIds, pathname } = props;
  if (props.isLoading && !props.hasData) return <ProjectListSkeleton />;
  if (!props.listLoading && !props.hasData)
    return (
      <EmptyProjectsMessage text={NO_PROJECTS_TEXT.get(props.show) ?? ""} />
    );
  if (
    !props.listLoading &&
    pinnedProjects.length === 0 &&
    listedProjects.length === 0
  )
    return <EmptyProjectsMessage text="No projects found" />;
  return (
    <>
      <PinnedProjectGroup projects={pinnedProjects} pathname={pathname} />
      {props.listLoading ? (
        <ProjectListSkeleton />
      ) : (
        <ProjectGroup
          label={pinnedProjects.length > 0 ? "All projects" : null}
          projects={listedProjects}
          pathname={pathname}
          pinnedIds={pinnedIds}
        />
      )}
    </>
  );
}

// Secondary (nested) sidebar listing projects — the /projects counterpart of
// ChatListSidebar, with the same shell, desktop-only rule and view menu
// (Active / Archived / All). Two server-driven categories, as there:
//   1. Pinned section — ?pinned=only&archived=with (includes archived pinned)
//   2. The view's list — see projectListFilters
// This retires bug #204 by construction: Pinned is a discrete rendered
// section above the list, never interleaved.
export function ProjectListSidebar() {
  const { isMobile } = useSidebar();
  const pathname = usePathname();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [show, setShow] = useState<ListShow>("active");
  const openProjectId = /^\/projects\/([^/]+)/.exec(pathname)?.[1];
  const data = useProjectListData(show, filter, openProjectId);

  // Only alongside the /projects routes; ChatListSidebar owns the rest.
  if (isMobile || !pathname.startsWith("/projects")) {
    return null;
  }

  const view = { show, onShowChange: setShow };
  return (
    <Sidebar collapsible="none" className="hidden w-64 shrink-0 md:flex">
      <ProjectListSidebarHeader
        view={view}
        search={{ query: filter, onQueryChange: setFilter }}
        onNewProject={() => setNewProjectOpen(true)}
      />
      <SidebarContent>
        <ListViewChip {...view} />
        <ProjectListSidebarContent {...data} show={show} pathname={pathname} />
      </SidebarContent>
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
      />
    </Sidebar>
  );
}
