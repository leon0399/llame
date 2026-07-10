import { SidebarTrigger } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { topBarClasses } from "../top-bar";

export interface ChatHeaderProps {
  className?: string;
}

export function PureChatHeader({ className }: ChatHeaderProps) {
  return (
    <header
      className={cn(topBarClasses, "bg-background px-2 gap-2", className)}
    >
      {/* Mobile-only: opens the sidebar sheet; the desktop rail has its own toggle. */}
      <SidebarTrigger className="md:hidden" />

      {/* Model selection now lives in the composer, grouped with Send. */}

      {/* @TODO: implement parallel model calls */}
      {/* <Button size={"icon"} variant="ghost" className="size-7 text-muted-foreground">
        <PlusIcon />
      </Button> */}
    </header>
  );
}

export const ChatHeader = PureChatHeader;
