"use client";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { Kbd } from "@workspace/ui/components/kbd";
import { cn } from "@workspace/ui/lib/utils";
import {
  detectPrimaryModifier,
  usePrimaryModifierKey,
} from "@workspace/ui/hooks/use-modifier-key";
import { SearchIcon, SquarePenIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCommandPalette } from "../command-palette";

export const SHORTCUT_KEY_NEW_CHAT = "o";
const SHORTCUT_KEY_SEARCH = "k";

/** True for the new-chat chord: the platform's primary modifier (⌘ on a
 *  Mac, Ctrl elsewhere) + Shift + O, with nothing else held. */
export function isNewChatShortcut(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  isMac: boolean,
): boolean {
  const modifier = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return (
    modifier &&
    e.shiftKey &&
    !e.altKey &&
    e.key.toLowerCase() === SHORTCUT_KEY_NEW_CHAT
  );
}

/** Opens a new chat from anywhere in the chat shell. A held chord's
 *  auto-repeat is ignored, so holding the keys navigates once. */
function useNewChatShortcut() {
  const router = useRouter();
  useEffect(() => {
    const isMac = detectPrimaryModifier() === "⌘";
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !isNewChatShortcut(e, isMac)) return;
      e.preventDefault();
      router.push("/");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);
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
  const modifierKey = usePrimaryModifierKey();
  const palette = useCommandPalette();
  useNewChatShortcut();

  const newChatShortcut = `${modifierKey}+Shift+${SHORTCUT_KEY_NEW_CHAT.toUpperCase()}`;
  const searchShortcut = `${modifierKey}+${SHORTCUT_KEY_SEARCH.toUpperCase()}`;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          render={<Link href="/" prefetch={false} />}
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
