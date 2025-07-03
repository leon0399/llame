import { SidebarTrigger } from "@workspace/ui/components/sidebar";
import { ModelSelector } from "../model-selector";
import { Button } from "@workspace/ui/components/button";
import { PlusIcon } from "lucide-react";

export function PureChatHeader() {
  return (
    <header className="flex sticky top-0 bg-background py-1.5 items-center px-2 md:px-2 gap-2">
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