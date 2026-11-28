"use client";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { Kbd } from "@workspace/ui/components/kbd";
import { cn } from "@workspace/ui/lib/utils";
import { SearchIcon, SquarePenIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useShortcut,
  useShortcutHint,
} from "@/lib/shortcuts/shortcuts-context";
import { useCommandPalette } from "../command-palette";
import { requestNewChat } from "@/lib/new-chat";

/** Opens a new chat from anywhere the shell is mounted. */
function useNewChatShortcut() {
  const router = useRouter();

  useShortcut("chat.new", () => {
    requestNewChat();
    router.push("/");
  });
}

function ShortcutKeyLabel({ children }: { children: React.ReactNode }) {
  return (
    <Kbd className="ml-auto group-data-[collapsible=icon]:hidden">
      {children}
    </Kbd>
  );
}

function shortcutTooltip(label: string, shortcut: string) {
  return {
    // TooltipContent is block by default; flex + the has-data-[slot=kbd] idiom
    // (the same one shadcn uses on Button) auto-spaces a trailing Kbd via gap
    // instead of a manual space/margin.
    className:
      "flex items-center has-data-[slot=kbd]:gap-1.5 has-data-[slot=kbd]:pe-1.5",
    children: (
      <>
        {label}
        <Kbd>{shortcut}</Kbd>
      </>
    ),
  };
}

export function AppSidebarActions() {
  const pathname = usePathname();
  const palette = useCommandPalette();
  useNewChatShortcut();

  const newChatShortcut = useShortcutHint("chat.new").label;
  const searchShortcut = useShortcutHint("palette.toggle").label;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          render={
            <Link href="/" prefetch={false} onNavigate={requestNewChat} />
          }
          isActive={pathname === "/"}
          className={cn("group/button")}
          tooltip={shortcutTooltip("New Chat", newChatShortcut)}
        >
          <SquarePenIcon />
          <span>New&nbsp;Chat</span>
          <ShortcutKeyLabel>{newChatShortcut}</ShortcutKeyLabel>
        </SidebarMenuButton>
      </SidebarMenuItem>

      <SidebarMenuItem className="">
        <SidebarMenuButton
          className={cn("group/button")}
          tooltip={shortcutTooltip("Search", searchShortcut)}
          onClick={() => palette.open()}
        >
          <SearchIcon />
          <span>Search</span>
          <ShortcutKeyLabel>{searchShortcut}</ShortcutKeyLabel>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
