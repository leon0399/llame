"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

import { cn } from "@workspace/ui/lib/utils";

/**
 * Collapsible toggles the visibility of a single panel — a lighter-weight
 * alternative to Accordion when there's no multi-item exclusivity to
 * coordinate. Compose it with `CollapsibleTrigger` and `CollapsibleContent`.
 *
 * Vendored from the [shadcn/ui Collapsible](https://ui.shadcn.com/docs/components/base/collapsible).
 *
 * @summary for toggling a single panel's visibility
 */
function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

/**
 * CollapsibleTrigger toggles its `Collapsible`'s open state when activated.
 *
 * @summary for the control that toggles the panel
 */
function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
  );
}

/**
 * CollapsibleContent is the panel shown while its `Collapsible` is open.
 * `animated` folds it on its measured height with the sidebar's own motion
 * (200ms, linear), for panels that sit in a sidebar.
 *
 * @summary for the panel toggled by CollapsibleTrigger
 */
function CollapsibleContent({
  className,
  animated = false,
  ...props
}: CollapsiblePrimitive.Panel.Props & { animated?: boolean }) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn(
        animated &&
          "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-linear data-ending-style:h-0 data-starting-style:h-0",
        className,
      )}
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
