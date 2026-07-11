"use client";

import { SidebarMenuButton } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The ONE disabled sidebar-item affordance (disabled-not-hidden convention),
 * shared by the primary nav's placeholders, the mobile Administration entry,
 * and the admin section nav's stubs — the aria/tab-order/pointer-events
 * recipe below is the actual logic and must not drift between call sites.
 * `className` extends per-surface metrics (e.g. the admin nav's row sizing)
 * without letting callers replace the inert-state recipe.
 */
export function DisabledMenuButton({
  tooltip,
  className,
  children,
}: {
  tooltip?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <SidebarMenuButton
      aria-disabled="true"
      // Disabled ⇒ out of the tab order, like a natively disabled button.
      tabIndex={-1}
      tooltip={tooltip}
      // aria-disabled sets pointer-events-none, which would also suppress
      // the collapsed-rail tooltip; keep pointer events but drop the
      // interactive hover/active fills so the item stays visibly inert.
      className={cn(
        "pointer-events-auto! cursor-default hover:bg-transparent! active:bg-transparent! hover:text-sidebar-foreground! active:text-sidebar-foreground!",
        className,
      )}
    >
      {children}
    </SidebarMenuButton>
  );
}
