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
      // `chromeless` is the inert treatment: no hover/pressed fill and no
      // focus ring of its own, which is also what `aria-disabled` would ask
      // for. `pointer-events-auto!` then keeps the collapsed-rail tooltip
      // reachable, since `aria-disabled` sets pointer-events-none.
      variant="chromeless"
      className={cn("pointer-events-auto! cursor-default", className)}
    >
      {children}
    </SidebarMenuButton>
  );
}
