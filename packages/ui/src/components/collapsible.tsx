"use client";

import * as React from "react";
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

/**
 * Collapsible toggles the visibility of a single panel — a lighter-weight
 * alternative to Accordion when there's no multi-item exclusivity to
 * coordinate. Compose it with `CollapsibleTrigger` and `CollapsibleContent`.
 *
 * Vendored from the [shadcn/ui Collapsible](https://ui.shadcn.com/docs/components/base/collapsible).
 *
 * @summary for toggling a single panel's visibility
 */
function Collapsible({
  asChild = false,
  render,
  children,
  ...props
}: CollapsiblePrimitive.Root.Props & {
  /** Render onto the single child element instead of a `div`. */
  asChild?: boolean;
}) {
  const resolvedRender =
    asChild && React.isValidElement(children)
      ? (children as React.ReactElement)
      : render;

  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      render={resolvedRender}
      {...props}
    >
      {asChild ? undefined : children}
    </CollapsiblePrimitive.Root>
  );
}

/**
 * CollapsibleTrigger toggles its `Collapsible`'s open state when activated.
 * Pass `asChild` (a compatibility alias for Base UI's `render`) to merge onto
 * an existing focusable element instead of adding one.
 *
 * @summary for the control that toggles the panel
 */
function CollapsibleTrigger({
  asChild = false,
  render,
  children,
  ...props
}: CollapsiblePrimitive.Trigger.Props & {
  /** Render onto the single child element instead of a native button. */
  asChild?: boolean;
}) {
  const resolvedRender =
    asChild && React.isValidElement(children)
      ? (children as React.ReactElement)
      : render;

  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      render={resolvedRender}
      {...props}
    >
      {asChild ? undefined : children}
    </CollapsiblePrimitive.Trigger>
  );
}

/**
 * CollapsibleContent is the panel shown while its `Collapsible` is open.
 *
 * @summary for the panel toggled by CollapsibleTrigger
 */
function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
