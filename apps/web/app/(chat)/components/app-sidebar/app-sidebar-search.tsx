"use client";

import { useState } from "react";

import Link from "next/link";
import { SearchIcon } from "lucide-react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";

import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import {
  MIN_SEARCH_LENGTH,
  useChatSearchQuery,
} from "@/lib/services/chat/search";

// Placeholder for untitled chats (title === null, generation pending or a
// content-only match) — matches the label used by the chat list itself.
const UNTITLED_CHAT_LABEL = "New chat";

/**
 * Sidebar chat search. Debounced + min-length so the type-ahead doesn't hammer
 * the api's single shared connection; results replace nothing (they render
 * below the box, the normal history stays visible when the box is empty).
 */
export function AppSidebarSearch() {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 300);
  const active = debounced.trim().length >= MIN_SEARCH_LENGTH;
  const { data: results, isFetching } = useChatSearchQuery(debounced);

  return (
    <SidebarGroup className="py-0">
      <SidebarGroupContent className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
        <SidebarInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats…"
          aria-label="Search chats"
          className="pl-8"
        />
        {active && (
          <SidebarMenu className="mt-2">
            {results && results.length > 0 ? (
              results.map((result) => (
                <SidebarMenuItem key={result.id}>
                  <SidebarMenuButton asChild className="h-auto py-1.5">
                    <Link
                      href={`/chat/${result.id}`}
                      onClick={() => setQuery("")}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm">
                          {result.title ?? UNTITLED_CHAT_LABEL}
                        </span>
                        {result.snippet && (
                          <span className="text-muted-foreground truncate text-xs">
                            {result.snippet}
                          </span>
                        )}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))
            ) : (
              <p className="text-muted-foreground px-2 py-1 text-xs">
                {isFetching ? "Searching…" : "No matching chats"}
              </p>
            )}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
