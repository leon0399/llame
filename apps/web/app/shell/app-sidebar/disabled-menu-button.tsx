"use client";

import { SidebarMenuButton } from "@workspace/ui/components/sidebar";

/**
 * The ONE disabled sidebar-item affordance (disabled-not-hidden convention),
 * shared by the primary nav's placeholders, the mobile Administration entry,
 * and the admin section nav's stubs — the aria/tab-order/pointer-events
 * recipe below is the actual logic and must not drift between call sites.
 */
export function DisabledMenuButton({
  tooltip,
  children,
}: {
  tooltip?: string;
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
      className="pointer-events-auto! cursor-default hover:bg-transparent! active:bg-transparent! hover:text-sidebar-foreground! active:text-sidebar-foreground!"
    >
      {children}
    </SidebarMenuButton>
  );
}
