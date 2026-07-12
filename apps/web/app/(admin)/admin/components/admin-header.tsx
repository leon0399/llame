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
    <header
      className={cn(topBarClasses, "gap-[0.45rem] bg-background px-[0.85rem]")}
    >
      <span className="text-[0.8rem] text-muted-foreground">
        Administration
      </span>
      <ChevronRightIcon className="size-3.5 text-muted-foreground" />
      <span className="text-[0.92rem] font-semibold">{section.label}</span>
    </header>
  );
}
