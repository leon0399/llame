"use client";

import { SidebarTrigger } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";

import { topBarClasses } from "./top-bar";

// Top bar for pages that own their header (the /projects pages — ChatHeader
// yields there): mobile sheet trigger + a truncating title.
export function PageHeader({ title }: { title: string }) {
  return (
    <header className={cn(topBarClasses, "bg-background gap-2 px-2")}>
      {/* Mobile-only: opens the sidebar sheet, same as ChatHeader. */}
      <SidebarTrigger className="md:hidden" />
      <span className="max-w-[60ch] truncate pl-1 text-sm font-semibold">
        {title}
      </span>
    </header>
  );
}
