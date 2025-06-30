import { useProjects } from "@/lib/services/project/queries";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@workspace/ui/components/dropdown-menu";
import { SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton } from "@workspace/ui/components/sidebar";
import { ChevronLeft, ChevronRight, FolderClosedIcon, FolderOpenIcon, MoreHorizontalIcon, PenLineIcon, PlusIcon, Sidebar, TrashIcon } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

const MAX_DISPLAYED_PROJECTS = 3;

function ProjectItem({ project, isActive }: { project: { id: string; name: string }; isActive?: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <Link href={`/projects/${project.id}`}>
          {isActive ? <FolderOpenIcon /> : <FolderClosedIcon />}
          <span>{project.name}</span>
        </Link>
      </SidebarMenuButton>
      
      <DropdownMenu modal={true}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            showOnHover={!isActive}
          >
            <MoreHorizontalIcon />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="bottom" align="start">
          <DropdownMenuItem
            className="cursor-pointer"
          >
            <PenLineIcon />
            <span>Rename</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="cursor-pointer text-destructive focus:bg-destructive/15 focus:text-destructive dark:text-red-500"
          >
            <TrashIcon />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

export function AppSidebarProjects() {
  const { data: projects, isLoading } = useProjects();

  const [displayedProjects, hiddenProjects] = useMemo(() => {
    return projects ? [projects.slice(0, MAX_DISPLAYED_PROJECTS), projects.slice(MAX_DISPLAYED_PROJECTS)] : [[], []];
  }, [projects]);

  if (isLoading) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {/* Max + 1 for "See more" button */}
            {Array.from({ length: MAX_DISPLAYED_PROJECTS + 1 }).map((_, index) => (
              <SidebarMenuItem key={index}>
                <SidebarMenuSkeleton className="*:bg-sidebar-accent-foreground/10" />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel
        className="sticky top-0 z-10 bg-sidebar"
      >
        Projects
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {displayedProjects.map((project, i) => (
            <ProjectItem
              key={project.id}
              project={project}
            />
          ))}
          {hiddenProjects.length > 0 && (
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton>
                    <MoreHorizontalIcon />
                    <span>See more</span>
                    <ChevronRight className="ml-auto" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start">
                  <DropdownMenuGroup>
                    {hiddenProjects.map((project) => (
                      <DropdownMenuItem key={project.id} asChild>
                        <Link href={`/projects/${project.id}`}>
                          <span>{project.name}</span>
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}