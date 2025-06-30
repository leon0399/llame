'use client';

import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { usePrimaryModifierKey } from "@workspace/ui/hooks/use-modifier-key";
import { ImagesIcon, LibraryIcon, SearchIcon, SquarePenIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
    <kbd className={cn(
      "text-muted-foreground ml-auto text-xs tracking-widest absolute top-2 right-1", 
      "group-data-[collapsible=icon]:hidden",
      className,
    )}>
      {children}
    </kbd>
  );
}

export function AppSidebarActions() {
  const pathname = usePathname();
  const modifierKey = usePrimaryModifierKey();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton 
          asChild
          isActive={pathname === '/'}
          className={cn('group/button')}
        >
          <Link href="/">
            <SquarePenIcon />
            <span>New Chat</span>
            <ShortcutKeyLabel
              className="opacity-0 group-hover/button:opacity-100"
            >
              {modifierKey}+Shift+{SHORTCUT_KEY_NEW_CHAT.toUpperCase()}
            </ShortcutKeyLabel>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>

      <SidebarMenuItem className="">
        <SidebarMenuButton
          className={cn('group/button')}
        >
          <SearchIcon />
          <span>Search</span>
          <ShortcutKeyLabel
            className="opacity-0 group-hover/button:opacity-100"
          >
            {modifierKey}+{SHORTCUT_KEY_SEARCH.toUpperCase()}
          </ShortcutKeyLabel>
        </SidebarMenuButton>
      </SidebarMenuItem>

      <SidebarMenuItem className="">
        <SidebarMenuButton
          className={cn('group/button')}
        >
          <ImagesIcon />
          <span>Library</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}