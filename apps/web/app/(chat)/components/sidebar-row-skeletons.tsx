import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@workspace/ui/components/sidebar";

// The loading placeholder for every sidebar-style row list (chats rail,
// projects rail, the project page's chat card) — one place for the row count
// idiom and the tint that keeps skeletons legible on our surfaces.
export function SidebarRowSkeletons({ count = 5 }: { count?: number }) {
  return (
    <SidebarMenu>
      {Array.from({ length: count }).map((_, index) => (
        <SidebarMenuItem key={index}>
          {/* The tint has to reach the skeleton shapes inside the row, so it
              is applied from this plain wrapper rather than as a className on
              the row primitive — `sidebar-accent-foreground/10` is the rail's
              own ink at 10%, and plain `bg-muted` all but disappears on
              `bg-sidebar` in light mode. */}
          <div className="[&_[data-slot=skeleton]]:bg-sidebar-accent-foreground/10">
            <SidebarMenuSkeleton />
          </div>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
