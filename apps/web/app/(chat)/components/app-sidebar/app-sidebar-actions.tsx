'use client';

import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@workspace/ui/components/sidebar";
import { Kbd } from "@workspace/ui/components/kbd";
import { cn } from "@workspace/ui/lib/utils";
import { usePrimaryModifierKey } from "@workspace/ui/hooks/use-modifier-key";
import { LibraryIcon, SearchIcon, SquarePenIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useChatContext } from "@/contexts/chat-context";
import { safeRandomUUID } from "@/lib/uuid";

const SHORTCUT_KEY_NEW_CHAT = 'o';
const SHORTCUT_KEY_SEARCH = 'k';

function ShortcutKeyLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Kbd
      className={cn(
        // bg-muted matches the button's hover:bg-sidebar-accent in this theme, so
        // give the cap a hairline border + surface fill to stay legible on hover.
        "ml-auto border bg-background transition-opacity group-data-[collapsible=icon]:hidden",
        className,
      )}
    >
      {children}
    </Kbd>
  );
}

function shortcutTooltip(label: string, shortcut: string) {
  return {
    // TooltipContent is block by default; flex + the has-data-[slot=kbd] idiom
    // (the same one shadcn uses on Button) auto-spaces a trailing Kbd via gap
    // instead of a manual space/margin.
    className: "flex items-center has-data-[slot=kbd]:gap-1.5 has-data-[slot=kbd]:pe-1.5",
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
  const modifierKey = usePrimaryModifierKey();
  const { setActiveChatId } = useChatContext();

  const newChatShortcut = `${modifierKey}+Shift+${SHORTCUT_KEY_NEW_CHAT.toUpperCase()}`;
  const searchShortcut = `${modifierKey}+${SHORTCUT_KEY_SEARCH.toUpperCase()}`;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          isActive={pathname === '/'}
          className={cn('group/button')}
          tooltip={shortcutTooltip('New Chat', newChatShortcut)}
        >
          <Link href="/" onClick={() => setActiveChatId(safeRandomUUID())}>
            <SquarePenIcon />
            <span>New&nbsp;Chat</span>
            <ShortcutKeyLabel className="opacity-0 group-hover/button:opacity-100">
              {newChatShortcut}
            </ShortcutKeyLabel>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>

      <SidebarMenuItem className="">
        <SidebarMenuButton
          className={cn('group/button')}
          tooltip={shortcutTooltip('Search', searchShortcut)}
        >
          <SearchIcon />
          <span>Search</span>
          <ShortcutKeyLabel className="opacity-0 group-hover/button:opacity-100">
            {searchShortcut}
          </ShortcutKeyLabel>
        </SidebarMenuButton>
      </SidebarMenuItem>

      <SidebarMenuItem className="">
        <SidebarMenuButton
          className={cn('group/button')}
          tooltip={'Library'}
        >
          <LibraryIcon />
          <span>Library</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
