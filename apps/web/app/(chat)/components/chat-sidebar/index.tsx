import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarSeparator } from "@workspace/ui/components/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible";
import { cn } from "@workspace/ui/lib/utils";
import { ModelSelector } from "../model-selector";
import { ChevronDown, CogIcon, MinusIcon, PlusIcon, SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { ChatSidebarConversationTree } from "./chat-sidebar-conversation-tree";

export function ChatSidebar({
  className,
}: {
  className?: string
}) {
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
      {/* @TODO: implement parallel model calls */}
      {/* <SidebarHeader>
        <SidebarMenu>
          {Array.from({ length: 3 }).map((_, index) => (
            <SidebarMenuItem key={index}>
              <Collapsible key={index}>
                <SidebarMenuButton asChild>
                  <ModelSelector popoverAlign="end" />
                </SidebarMenuButton>

                <CollapsibleTrigger asChild>
                  <SidebarMenuAction>
                    <SlidersHorizontalIcon className="opacity-50" />
                  </SidebarMenuAction>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <Collapsible className="group/collapsible">
                    <SidebarGroup>
                      <SidebarGroupLabel asChild>
                        <CollapsibleTrigger>
                          Advanced Options
                          <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
                        </CollapsibleTrigger>
                      </SidebarGroupLabel>

                      <CollapsibleContent>
                        <SidebarGroupContent />
                      </CollapsibleContent>
                    </SidebarGroup>
                  </Collapsible>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Button
                variant="ghost"
                className="h-8 !pr-1.5 text-muted-foreground"
              >
                Add model
                <PlusIcon className="ml-auto text-muted-foreground" />
              </Button>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarSeparator className='mx-0' /> */}

      <SidebarContent>
        <ChatSidebarConversationTree />
      </SidebarContent>
    </Sidebar>
  );
}