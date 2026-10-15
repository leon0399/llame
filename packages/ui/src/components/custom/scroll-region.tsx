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
 * Chromium puts `overflow: auto` nodes in the tab order when they scroll;
 * Firefox and Safari do not, so a bare capped `<pre>` / `<div>` hides lines
 * below the fold from keyboard-only readers. A labeled `<fieldset>` is the
 * semantic group role (axe rejects `aria-label` on a role-less `div`; a
 * labeled `<section>` would flood the landmark list across 87 tools).
 */
export function ScrollRegion({
  label,
  className,
  children,
}: ScrollRegionProps) {
  return (
    <fieldset
      aria-label={label}
      // Scrollport focus target: Firefox/Safari omit bare overflow nodes from
      // the tab order (Chromium does not). See JSDoc.
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
