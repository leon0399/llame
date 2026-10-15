import type { ReactNode } from "react";

import { cn } from "@workspace/ui/lib/utils";

type ScrollRegionProps = {
  /** Accessible name for the focusable scrollport. */
  label: string;
  className?: string;
  children: ReactNode;
};

/**
 * Height-capped overflow region that keyboard users can reach.
 *
 * Safari still omits bare `overflow` nodes from the tab order (WebKit
 * 277290); Chromium made them focusable by default in 132, and Firefox has
 * since v4. `tabIndex={0}` is unconditional so the primitive stays correct
 * across engines. A labeled `<fieldset>` is the semantic group role (axe
 * rejects `aria-label` on a role-less `div`; a labeled `<section>` would
 * flood the landmark list across 87 tools).
 */
export function ScrollRegion({
  label,
  className,
  children,
}: ScrollRegionProps) {
  return (
    <fieldset
      aria-label={label}
      // Explicit focus target for Safari; Chromium/Firefox already include
      // bare scrollers in the tab order. See JSDoc.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className={cn(
        "m-0 min-w-0 border-0 p-0 max-h-60 overflow-auto",
        className,
      )}
    >
      {children}
    </fieldset>
  );
}
