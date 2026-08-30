import { Sidebar, SidebarContent } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { ChatSidebarConversationTree } from "./chat-sidebar-conversation-tree";

export function ChatSidebar({ className }: { className?: string }) {
  return (
    <Sidebar
      side="right"
      collapsible="none"
      className={cn(
        "sticky top-0 hidden h-svh lg:flex group-data-[side=right]:border-l-0",
        className,
      )}
      style={
        {
          "--sidebar-width": "24rem",
        } as React.CSSProperties
      }
    >
      <SidebarContent>
        <ChatSidebarConversationTree />
      </SidebarContent>
    </Sidebar>
  );
}
