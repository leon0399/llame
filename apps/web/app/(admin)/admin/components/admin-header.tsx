"use client";

import { ChevronRightIcon } from "lucide-react";
import { usePathname } from "next/navigation";

import { cn } from "@workspace/ui/lib/utils";

import { topBarClasses } from "@/app/shell/top-bar";

import { activeAdminSection } from "./admin-sections";

/** "Administration › <Section>" breadcrumb, shared by every admin page. */
export function AdminHeader() {
  const pathname = usePathname();
  const section = activeAdminSection(pathname);

  return (
    <header className={cn(topBarClasses, "gap-1.75 bg-background px-3.5")}>
      <span className="text-xs text-muted-foreground">Administration</span>
      <ChevronRightIcon className="size-3.5 text-muted-foreground" />
      <span className="text-sm font-semibold">{section.label}</span>
    </header>
  );
}
