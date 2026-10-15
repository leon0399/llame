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
 * below the fold from keyboard-only readers. `tabIndex={0}` matches the
 * dialog sticky-footer scrollport pattern in `dialog.stories.tsx`.
 */
export function ScrollRegion({
  label,
  className,
  children,
}: ScrollRegionProps) {
  return (
    <section
      aria-label={label}
      // Scrollport focus target: Firefox/Safari omit bare overflow nodes from
      // the tab order (Chromium does not). See JSDoc.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className={cn("max-h-60 overflow-auto", className)}
    >
      {children}
    </section>
  );
}
