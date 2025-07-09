import { SidebarTrigger } from "@workspace/ui/components/sidebar";
import { ModelSelector } from "../model-selector";
import { Button } from "@workspace/ui/components/button";
import { PlusIcon } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

export interface ChatHeaderProps {
  className?: string;
}

export function PureChatHeader({ className }: ChatHeaderProps) {
  return (
    <header className={cn(
      "flex bg-background py-1.5 items-center px-2 md:px-2 gap-2",
      className,
    )}>
      <SidebarTrigger />

      <ModelSelector />

      {/* @TODO: implement parallel model calls */}
      {/* <Button size={"icon"} variant="ghost" className="size-7 text-muted-foreground">
        <PlusIcon />
      </Button> */}
    </header>
  )
}

export const ChatHeader = PureChatHeader;