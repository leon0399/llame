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
          <SidebarMenuSkeleton className="*:bg-sidebar-accent-foreground/10" />
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
