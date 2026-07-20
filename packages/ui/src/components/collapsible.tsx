"use client";

import { Collapsible as CollapsiblePrimitive } from "radix-ui";

/**
 * Collapsible toggles the visibility of a single panel — a lighter-weight
 * alternative to Accordion when there's no multi-item exclusivity to
 * coordinate. Compose it with `CollapsibleTrigger` and `CollapsibleContent`.
 *
 * Vendored from the [shadcn/ui Collapsible](https://ui.shadcn.com/docs/components/radix/collapsible).
 *
 * @summary for toggling a single panel's visibility
 */
function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

/**
 * CollapsibleTrigger toggles its `Collapsible`'s open state when activated.
 *
 * @summary for the control that toggles the panel
 */
function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  );
}

/**
 * CollapsibleContent is the panel shown while its `Collapsible` is open.
 *
 * @summary for the panel toggled by CollapsibleTrigger
 */
function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
